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
import {
  DEMO_CARD_AMOUNT,
  DEMO_CARD_CONTEXT,
  DEMO_MERCHANT_NAME,
  DEMO_MERCHANT_URL,
} from './constants';
import { CARD_FLOW as C } from './content';

type Step =
  | 'intro'
  | 'fetch-pm'
  | 'pick-pm'
  | 'explain-pm'
  | 'create-spend'
  | 'await-approval'
  | 'approval-timeout'
  | 'show-card'
  | 'open-url'
  | 'done'
  | 'error';

interface CardFlowProps {
  spendRequestRepo: ISpendRequestResource;
  paymentMethodsResource: IPaymentMethodsResource;
  paymentMethodId?: string;
  onComplete: (result: {
    paymentMethodId: string;
    success: boolean;
  }) => void;
}

function formatPmLabel(pm: PaymentMethod): string {
  return `${pm.card_details?.brand ?? pm.type} ****${pm.card_details?.last4 ?? ''}`;
}

function formatCardNumber(num: string): string {
  return num.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

export const CardFlow: React.FC<CardFlowProps> = ({
  spendRequestRepo,
  paymentMethodsResource,
  paymentMethodId: initialPaymentMethodId,
  onComplete,
}) => {
  const [step, setStep] = useState<Step>('intro');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPmIndex, setSelectedPmIndex] = useState(0);
  const [spendRequest, setSpendRequest] = useState<SpendRequest | null>(null);
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

        // Resolve payment method
        let pmId = initialPaymentMethodId;
        if (!pmId) {
          setStep('fetch-pm');
          const methods = await paymentMethodsResource.listPaymentMethods();
          if (methods.length === 0) {
            setError(
              'No payment methods found. Open the Link app (link.com) and add a card to your wallet, then run the demo again.',
            );
            setStep('error');
            onComplete({ paymentMethodId: '', success: false });
            return;
          }

          if (methods.length === 1) {
            const pm = methods[0];
            setPaymentMethod(pm);
            setPaymentMethods(methods);
            pmId = pm.id;
          } else {
            setPaymentMethods(methods);
            const defaultIdx = methods.findIndex((m) => m.is_default);
            setSelectedPmIndex(defaultIdx >= 0 ? defaultIdx : 0);
            setStep('pick-pm');
            pmId = await waitForPmSelection();
            const pm = methods.find((m) => m.id === pmId) ?? methods[0];
            setPaymentMethod(pm);
          }

          setStep('explain-pm');
          await waitForEnter();
        }

        setStep('create-spend');
        const result = await spendRequestRepo.createSpendRequest({
          payment_details: pmId,
          credential_type: 'card' as const,
          amount: DEMO_CARD_AMOUNT,
          context: DEMO_CARD_CONTEXT,
          merchant_name: DEMO_MERCHANT_NAME,
          merchant_url: DEMO_MERCHANT_URL,
          request_approval: true,
          test: true,
        });
        setSpendRequest(result);

        setStep('await-approval');
        for (;;) {
          try {
            await pollUntilApproved(spendRequestRepo, result.id);
            break;
          } catch (err) {
            if ((err as Error).message === 'Approval polling timed out') {
              setStep('approval-timeout');
              const choice = await waitForRetryChoice();
              if (choice === 'exit') {
                onComplete({ paymentMethodId: pmId ?? '', success: false });
                return;
              }
              setStep('await-approval');
            } else {
              throw err;
            }
          }
        }
        const approved = await spendRequestRepo.getSpendRequest(result.id, {
          include: ['card'],
        });
        if (approved) setSpendRequest(approved);

        setStep('show-card');
        await waitForEnter();

        setStep('open-url');
        openUrl(DEMO_MERCHANT_URL);
        setStep('done');
        onComplete({ paymentMethodId: pmId, success: true });
      } catch (err) {
        setError((err as Error).message);
        setStep('error');
        onComplete({
          paymentMethodId: paymentMethod?.id ?? '',
          success: false,
        });
      }
    };
    run();
  }, []);

  const pmLabel = paymentMethod ? formatPmLabel(paymentMethod) : '';

  const card = spendRequest?.card;
  const pastStep = (target: Step) => {
    const order: Step[] = [
      'intro',
      'fetch-pm',
      'pick-pm',
      'explain-pm',
      'create-spend',
      'await-approval',
      'show-card',
      'open-url',
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
        {C.title}
      </Text>

      {/* Intro + checklist */}
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color="yellow">[testmode]</Text>
          <Text dimColor>{DEMO_MERCHANT_URL}</Text>
        </Box>
        <MarkdownText>{C.intro.description}</MarkdownText>
        <Box marginTop={1} flexDirection="column">
          <Text>What happens:</Text>
          {C.intro.steps.map((s, i) => {
            const doneAfter: Step[] = [
              'pick-pm',
              'create-spend',
              'await-approval',
              'show-card',
            ];
            const activeFrom: Step[] = [
              'fetch-pm',
              'create-spend',
              'await-approval',
              'show-card',
            ];
            const done = pastStep(doneAfter[i]);
            const active =
              !done && (step === activeFrom[i] || pastStep(activeFrom[i]));
            return done ? (
              <Text key={s} dimColor strikethrough>
                {' '}
                {i + 1}. {s}
              </Text>
            ) : active ? (
              <Text key={s} bold color="cyan">
                {' '}
                {i + 1}. {s}
              </Text>
            ) : (
              <Text key={s} dimColor>
                {' '}
                {i + 1}. {s}
              </Text>
            );
          })}
        </Box>
        {step === 'intro' && prompt(C.intro.prompt)}
      </Box>

      {/* Step detail — only the active step's content is shown */}

      {step === 'fetch-pm' && (
        <Box flexDirection="column">
          <Text dimColor>
            Fetching payment methods from your Link wallet...
          </Text>
        </Box>
      )}

      {(step === 'pick-pm' || step === 'explain-pm') && (
        <Box flexDirection="column">
          {step === 'pick-pm' && paymentMethods.length > 1 && (
            <Box flexDirection="column">
              <Text>Which payment method should we use for the demo?</Text>
              <Box flexDirection="column" marginTop={1}>
                {paymentMethods.map((pm, i) => (
                  <Text key={pm.id}>
                    {i === selectedPmIndex ? (
                      <Text color="cyan" bold>
                        {'>'} {formatPmLabel(pm)}
                        {pm.is_default ? ' (default)' : ''}
                      </Text>
                    ) : (
                      <Text dimColor>
                        {'  '}
                        {formatPmLabel(pm)}
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
          {paymentMethod && (
            <Box flexDirection="column">
              <Text color="green">
                ✓ Using <Text bold>{pmLabel}</Text>
                {paymentMethod.is_default ? ' (default)' : ''}
              </Text>
              {step === 'explain-pm' && prompt()}
            </Box>
          )}
        </Box>
      )}

      {step === 'create-spend' && (
        <Box flexDirection="column">
          <MarkdownText>{C.createSpend.description}</MarkdownText>
          <Box marginY={1}>
            <Text color="cyan">{C.createSpend.loading}</Text>
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
                <Text>{C.approval.description}</Text>
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
                  <Text dimColor>{C.approval.browserHint}</Text>
                </Box>
                <Box marginY={1}>
                  <Text color="cyan">{C.approval.loading}</Text>
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

      {(step === 'show-card' || step === 'open-url' || step === 'done') &&
        card && (
          <Box flexDirection="column">
            <Text color="green">✓ Approved!</Text>
            <MarkdownText>{C.showCard.description}</MarkdownText>
            <Box flexDirection="column" paddingX={2} marginTop={1}>
              <Text>
                <Text dimColor>Number </Text>
                <Text bold>{formatCardNumber(card.number)}</Text>
                {'  '}
                <Text dimColor>Exp </Text>
                <Text bold>{formatExpiry(card.exp_month, card.exp_year)}</Text>
                {'  '}
                <Text dimColor>CVC </Text>
                <Text bold>{card.cvc}</Text>
                {card.billing_address?.postal_code && (
                  <>
                    {'  '}
                    <Text dimColor>Zip </Text>
                    <Text bold>{card.billing_address.postal_code}</Text>
                  </>
                )}
                {card.valid_until && (
                  <>
                    {'  '}
                    <Text dimColor>
                      expires{' '}
                      {new Date(card.valid_until).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                  </>
                )}
              </Text>
            </Box>
            {step === 'show-card' && prompt(C.showCard.prompt)}
          </Box>
        )}

      {step === 'done' && (
        <Box flexDirection="column">
          <Text color="green">✓ {C.done.success}</Text>
          <Text>{C.done.detail}</Text>
        </Box>
      )}

      {step === 'error' && <Text color="red">Error: {error}</Text>}
    </Box>
  );
};
