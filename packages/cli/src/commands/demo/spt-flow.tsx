import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
  PaymentMethod,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { MarkdownText } from '../../utils/markdown-text';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { decodeStripeChallenge } from '../mpp/decode';
import { type PayResult, runMppPay } from '../mpp/pay';
import {
  DEMO_CLIMATE_API_URL,
  DEMO_MPP_DEV_URL,
  DEMO_SPT_AMOUNT,
  DEMO_SPT_CONTEXT,
} from './constants';
import { SPT_FLOW as S } from './content';

type Step =
  | 'intro'
  | 'fetch-pm'
  | 'pick-pm'
  | 'probe'
  | 'explain-402'
  | 'create-spend'
  | 'await-approval'
  | 'approval-timeout'
  | 'mpp-pay-gate'
  | 'mpp-pay'
  | 'done'
  | 'error';

interface SptFlowProps {
  spendRequestRepo: ISpendRequestResource;
  paymentMethodsResource: IPaymentMethodsResource;
  paymentMethodId?: string;
  onComplete: (success: boolean) => void;
}

export const SptFlow: React.FC<SptFlowProps> = ({
  spendRequestRepo,
  paymentMethodsResource,
  paymentMethodId: initialPaymentMethodId,
  onComplete,
}) => {
  const [step, setStep] = useState<Step>('intro');
  const [networkId, setNetworkId] = useState<string>('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPmIndex, setSelectedPmIndex] = useState(0);
  const [spendRequest, setSpendRequest] = useState<SpendRequest | null>(null);
  const [payResult, setPayResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<string>('');

  const approvalUrl = spendRequest?.approval_url ?? '';

  const enterResolver = useRef<(() => void) | null>(null);
  const pmResolver = useRef<((id: string) => void) | null>(null);
  const retryChoiceResolver = useRef<
    ((choice: 'retry' | 'exit') => void) | null
  >(null);

  function waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      enterResolver.current = resolve;
    });
  }

  function waitForPmSelection(): Promise<string> {
    return new Promise((resolve) => {
      pmResolver.current = resolve;
    });
  }

  function waitForRetryChoice(): Promise<'retry' | 'exit'> {
    return new Promise((resolve) => {
      retryChoiceResolver.current = resolve;
    });
  }

  useInput((input, key) => {
    if (step === 'pick-pm') {
      if (key.upArrow) {
        setSelectedPmIndex((i) => (i > 0 ? i - 1 : paymentMethods.length - 1));
      } else if (key.downArrow) {
        setSelectedPmIndex((i) => (i < paymentMethods.length - 1 ? i + 1 : 0));
      } else if (key.return && pmResolver.current) {
        const pm = paymentMethods[selectedPmIndex];
        const resolve = pmResolver.current;
        pmResolver.current = null;
        resolve(pm.id);
      }
    } else if (step === 'approval-timeout' && retryChoiceResolver.current) {
      if (input === 'r') {
        const resolve = retryChoiceResolver.current;
        retryChoiceResolver.current = null;
        resolve('retry');
      } else if (input === 'q') {
        const resolve = retryChoiceResolver.current;
        retryChoiceResolver.current = null;
        resolve('exit');
      }
    } else if (key.return) {
      if (enterResolver.current) {
        const resolve = enterResolver.current;
        enterResolver.current = null;
        resolve();
      } else if (
        (step === 'await-approval' || step === 'approval-timeout') &&
        approvalUrl
      ) {
        openUrl(approvalUrl);
      }
    }
  });

  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs once
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const run = async () => {
      try {
        await waitForEnter();

        let pmId = initialPaymentMethodId;
        if (!pmId) {
          setStep('fetch-pm');
          const methods = await paymentMethodsResource.listPaymentMethods();
          if (methods.length === 0) {
            throw new Error(
              'No payment methods found. Open the Link app (link.com) and add a card to your wallet, then run the demo again.',
            );
          }

          if (methods.length === 1) {
            pmId = methods[0].id;
          } else {
            setPaymentMethods(methods);
            const defaultIdx = methods.findIndex((m) => m.is_default);
            setSelectedPmIndex(defaultIdx >= 0 ? defaultIdx : 0);
            setStep('pick-pm');
            pmId = await waitForPmSelection();
          }
        }

        setStep('probe');
        const probeResponse = await fetch(DEMO_CLIMATE_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: DEMO_SPT_AMOUNT }),
        });

        if (probeResponse.status !== 402) {
          throw new Error(
            `Expected 402 from ${DEMO_CLIMATE_API_URL}, got ${probeResponse.status}`,
          );
        }

        const wwwAuth = probeResponse.headers.get('www-authenticate') ?? '';
        const decoded = decodeStripeChallenge(wwwAuth);
        setNetworkId(decoded.network_id);

        setStep('explain-402');
        await waitForEnter();

        setStep('create-spend');
        const result = await spendRequestRepo.createSpendRequest({
          payment_details: pmId,
          credential_type: 'shared_payment_token' as const,
          network_id: decoded.network_id,
          amount: DEMO_SPT_AMOUNT,
          context: DEMO_SPT_CONTEXT,
          request_approval: true,
          test: true,
        });
        setSpendRequest(result);

        setStep('await-approval');
        for (;;) {
          try {
            const approved = await pollUntilApproved(
              spendRequestRepo,
              result.id,
            );
            setSpendRequest(approved);
            break;
          } catch (err) {
            if ((err as Error).message === 'Approval polling timed out') {
              setStep('approval-timeout');
              const choice = await waitForRetryChoice();
              if (choice === 'exit') {
                onComplete(false);
                return;
              }
              setStep('await-approval');
            } else {
              throw err;
            }
          }
        }

        setStep('mpp-pay-gate');
        await waitForEnter();
        setStep('mpp-pay');
        const payResponse = await runMppPay(
          DEMO_CLIMATE_API_URL,
          result.id,
          'POST',
          JSON.stringify({ amount: DEMO_SPT_AMOUNT }),
          undefined,
          spendRequestRepo,
        );
        setPayResult(payResponse);
        setStep('done');
        onComplete(true);
      } catch (err) {
        setError((err as Error).message);
        setStep('error');
        onComplete(false);
      }
    };
    run();
  }, []);

  const pastStep = (target: Step) => {
    const order: Step[] = [
      'intro',
      'fetch-pm',
      'pick-pm',
      'probe',
      'explain-402',
      'create-spend',
      'await-approval',
      'mpp-pay-gate',
      'mpp-pay',
      'done',
    ];
    return order.indexOf(step) > order.indexOf(target);
  };

  const prompt = (label = 'Press [Enter] to continue') => (
    <Text dimColor>
      {'\n'}
      {'>'} {label}
    </Text>
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">
        {S.title}
      </Text>

      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="yellow">[testmode]</Text>
          <Text dimColor>
            {DEMO_CLIMATE_API_URL}
            {'  '}
            {DEMO_MPP_DEV_URL}
          </Text>
        </Box>
        <MarkdownText>{S.intro.description}</MarkdownText>
        <Box marginTop={1} flexDirection="column">
          <Text>{S.intro.preamble}</Text>
          {S.intro.steps.map((s, i) => {
            const doneAfter: Step[] = [
              'pick-pm',
              'probe',
              'create-spend',
              'await-approval',
              'mpp-pay',
            ];
            const activeFrom: Step[] = [
              'fetch-pm',
              'probe',
              'create-spend',
              'await-approval',
              'mpp-pay-gate',
            ];
            const done = pastStep(doneAfter[i]);
            const active =
              !done && (step === activeFrom[i] || pastStep(activeFrom[i]));
            const label = s.replace(/`/g, '');
            return done ? (
              <Text key={s} dimColor strikethrough>
                {' '}
                {i + 1}. {label}
              </Text>
            ) : active ? (
              <Text key={s} bold color="cyan">
                {' '}
                {i + 1}. {label}
              </Text>
            ) : (
              <Text key={s} dimColor>
                {' '}
                {i + 1}. {label}
              </Text>
            );
          })}
        </Box>
        {step === 'intro' && prompt(S.intro.prompt)}
      </Box>

      {step === 'fetch-pm' && (
        <Box marginY={1}>
          <Text color="cyan">Fetching payment methods...</Text>
        </Box>
      )}

      {step === 'pick-pm' && paymentMethods.length > 1 && (
        <Box flexDirection="column">
          <Text>Which payment method should we use for the demo?</Text>
          <Box flexDirection="column" marginTop={1}>
            {paymentMethods.map((pm, i) => (
              <Text key={pm.id}>
                {i === selectedPmIndex ? (
                  <Text color="cyan" bold>
                    {'>'}{' '}
                    {pm.card_details
                      ? `${pm.card_details.brand} ****${pm.card_details.last4}`
                      : pm.type}
                    {pm.is_default ? ' (default)' : ''}
                  </Text>
                ) : (
                  <Text dimColor>
                    {'  '}
                    {pm.card_details
                      ? `${pm.card_details.brand} ****${pm.card_details.last4}`
                      : pm.type}
                    {pm.is_default ? ' (default)' : ''}
                  </Text>
                )}
              </Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Use ↑↓ to select, [Enter] to confirm</Text>
          </Box>
        </Box>
      )}

      {/* Step detail — only the active step's content is shown */}

      {(step === 'probe' || step === 'explain-402') && (
        <Box flexDirection="column">
          <MarkdownText>{S.probe.description}</MarkdownText>
          {step === 'probe' && (
            <Box marginY={1}>
              <Text color="cyan">{S.probe.loading}</Text>
            </Box>
          )}
          {step === 'explain-402' && networkId && (
            <>
              <Text color="green">
                ✓ Got HTTP 402 — network_id: <Text bold>{networkId}</Text>
              </Text>
              <MarkdownText>{S.probe.detail}</MarkdownText>
              {prompt()}
            </>
          )}
        </Box>
      )}

      {step === 'create-spend' && (
        <Box flexDirection="column">
          <MarkdownText>{S.createSpend.description}</MarkdownText>
          <Box marginY={1}>
            <Text color="cyan">{S.createSpend.loading}</Text>
          </Box>
        </Box>
      )}

      {(step === 'await-approval' || step === 'approval-timeout') &&
        spendRequest && (
          <Box flexDirection="column">
            <Text color="green">
              ✓ Spend request created ({spendRequest.id})
            </Text>
            {step === 'await-approval' && (
              <>
                <Text>{S.approval.description}</Text>
                <Box
                  flexDirection="column"
                  borderStyle="round"
                  borderColor="cyan"
                  paddingX={2}
                  paddingY={1}
                  marginTop={1}
                >
                  <Text>
                    Approve at:{' '}
                    <Text bold color="cyan">
                      {approvalUrl}
                    </Text>
                  </Text>
                  <Text dimColor>{S.approval.browserHint}</Text>
                </Box>
                <Box marginY={1}>
                  <Text color="cyan">{S.approval.loading}</Text>
                </Box>
              </>
            )}
            {step === 'approval-timeout' && (
              <>
                <Text color="yellow">
                  ⚠ Approval timed out (5 min). Still pending — you can still
                  approve.
                </Text>
                <Box
                  flexDirection="column"
                  borderStyle="round"
                  borderColor="yellow"
                  paddingX={2}
                  paddingY={1}
                  marginTop={1}
                >
                  <Text>
                    Approve at:{' '}
                    <Text bold color="cyan">
                      {approvalUrl}
                    </Text>
                  </Text>
                  <Text dimColor>Press [Enter] to open in browser</Text>
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>r Retry polling q Quit demo</Text>
                </Box>
              </>
            )}
          </Box>
        )}

      {(step === 'mpp-pay-gate' || step === 'mpp-pay') && (
        <Box flexDirection="column">
          <Text color="green">✓ Approved!</Text>
          <MarkdownText>{S.mppPay.description}</MarkdownText>
          {step === 'mpp-pay-gate' && prompt(S.mppPay.prompt)}
          {step === 'mpp-pay' && (
            <Box marginY={1}>
              <Text color="cyan">{S.mppPay.loading}</Text>
            </Box>
          )}
        </Box>
      )}

      {step === 'done' && payResult && (
        <Box flexDirection="column">
          <Text bold color="green">
            ✓ {S.done.success} (HTTP {payResult.status})
          </Text>
          <MarkdownText>{S.done.detail}</MarkdownText>
        </Box>
      )}

      {step === 'error' && <Text color="red">Error: {error}</Text>}
    </Box>
  );
};
