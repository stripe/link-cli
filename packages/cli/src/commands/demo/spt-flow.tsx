import type {
  CreateSpendRequestParams,
  IPaymentMethodsResource,
  ISpendRequestResource,
  PaymentMethod,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { decodeStripeChallenge } from '../mpp/decode';
import { type PayResult, runMppPay } from '../mpp/pay';
import { AppDownloadQrCodes } from '../spend-request/app-download-qr-codes';
import {
  DEMO_CLIMATE_API_URL,
  DEMO_MPP_DEV_URL,
  DEMO_SPT_AMOUNT,
  DEMO_SPT_CONTEXT,
} from './constants';
import { SPT_FLOW as S } from './content';
import { StepData } from './step-data';

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
  const [spendRequestPayload, setSpendRequestPayload] =
    useState<CreateSpendRequestParams | null>(null);
  const [payResult, setPayResult] = useState<PayResult | null>(null);
  const [challengeData, setChallengeData] = useState<Record<
    string,
    unknown
  > | null>(null);
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
        setChallengeData({
          status: probeResponse.status,
          method: decoded.method,
          intent: decoded.intent,
          network_id: decoded.network_id,
          realm: decoded.realm,
        });

        setStep('explain-402');
        await waitForEnter();

        setStep('create-spend');
        const payload = {
          payment_details: pmId,
          credential_type: 'shared_payment_token' as const,
          network_id: decoded.network_id,
          amount: DEMO_SPT_AMOUNT,
          context: DEMO_SPT_CONTEXT,
          request_approval: true,
          test: true,
        };
        setSpendRequestPayload(payload);
        const result = await spendRequestRepo.createSpendRequest(payload);
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
        <Text>{S.intro.description}</Text>
        <Box marginTop={1}>
          <Text>
            {S.intro.preamble}
            {'\n'}
            {S.intro.steps.map((s, i) => ` ${i + 1}. ${s}`).join('\n')}
          </Text>
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

      {pastStep('fetch-pm') && (
        <Box flexDirection="column">
          <Text>{S.probe.description}</Text>
          {step === 'probe' && (
            <Box marginY={1}>
              <Text color="cyan">{S.probe.loading}</Text>
            </Box>
          )}
        </Box>
      )}

      {pastStep('probe') && networkId && (
        <Box flexDirection="column">
          <Text color="green">
            ✓ Got HTTP 402 with a <Text bold>WWW-Authenticate</Text> challenge
          </Text>
          {challengeData && <StepData data={challengeData} />}
          <Text>{S.probe.detail}</Text>
          {step === 'explain-402' && prompt()}
        </Box>
      )}

      {pastStep('explain-402') && (
        <Box flexDirection="column">
          <Text>{S.createSpend.description}</Text>
          {spendRequestPayload && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>spend-request create</Text>
              <Box
                flexDirection="column"
                borderStyle="single"
                borderColor="gray"
                paddingX={2}
              >
                <Text>
                  {JSON.stringify(
                    spendRequestPayload as unknown as Record<string, unknown>,
                    null,
                    2,
                  )}
                </Text>
              </Box>
            </Box>
          )}
          {step === 'create-spend' && (
            <Box marginY={1}>
              <Text color="cyan">{S.createSpend.loading}</Text>
            </Box>
          )}
        </Box>
      )}

      {(step === 'await-approval' ||
        step === 'approval-timeout' ||
        pastStep('await-approval')) &&
        spendRequest && (
          <Box flexDirection="column">
            <Text color="green">
              ✓ Spend request created (ID: <Text bold>{spendRequest.id}</Text>)
            </Text>
            <StepData
              data={{
                id: spendRequest.id,
                status: spendRequest.status,
                credential_type: spendRequest.credential_type,
                network_id: spendRequest.network_id,
                amount: spendRequest.amount,
                context: spendRequest.context,
                approval_url: spendRequest.approval_url,
              }}
            />
          </Box>
        )}

      {step === 'await-approval' && (
        <Box flexDirection="column">
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
          <AppDownloadQrCodes />
          <Box marginY={1}>
            <Text color="cyan">{S.approval.loading}</Text>
          </Box>
        </Box>
      )}

      {step === 'approval-timeout' && (
        <Box flexDirection="column">
          <Text color="yellow">
            ⚠ Approval timed out (5 min). The spend request is still pending —
            you can still approve it.
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
        </Box>
      )}

      {pastStep('await-approval') && step !== 'error' && (
        <Box flexDirection="column">
          {(step === 'mpp-pay-gate' || pastStep('mpp-pay-gate')) && (
            <>
              <Text color="green">✓ Approved!</Text>
              <Text>{S.mppPay.description}</Text>
            </>
          )}
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
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="green"
            paddingX={2}
            paddingY={1}
          >
            <Text bold color="green">
              {S.done.success}
            </Text>
            <Text>
              Status: <Text bold>HTTP {payResult.status}</Text>
            </Text>
            {payResult.body && <Text>{payResult.body}</Text>}
          </Box>
          <Box marginTop={1}>
            <Text>{S.done.detail}</Text>
          </Box>
        </Box>
      )}

      {step === 'error' && <Text color="red">Error: {error}</Text>}
    </Box>
  );
};
