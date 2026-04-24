import type {
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
import {
  DEMO_CARD_AMOUNT,
  DEMO_CARD_CONTEXT,
  DEMO_MERCHANT_NAME,
  DEMO_MERCHANT_URL,
} from './constants';
import { CARD_FLOW as C } from './content';
import { StepData } from './step-data';

type Step =
  | 'intro'
  | 'fetch-pm'
  | 'explain-pm'
  | 'create-spend'
  | 'await-approval'
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
  const [spendRequest, setSpendRequest] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');

  const approvalUrl = spendRequest?.approval_url ?? '';

  const enterResolver = useRef<(() => void) | null>(null);

  function waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      enterResolver.current = resolve;
    });
  }

  useInput((_input, key) => {
    if (key.return) {
      if (enterResolver.current) {
        const resolve = enterResolver.current;
        enterResolver.current = null;
        resolve();
      } else if (step === 'await-approval' && approvalUrl) {
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
          const pm = methods.find((m) => m.is_default) ?? methods[0];
          setPaymentMethod(pm);
          pmId = pm.id;

          setStep('explain-pm');
          await waitForEnter();
        }

        setStep('create-spend');
        const result = await spendRequestRepo.createSpendRequest({
          payment_details: pmId,
          credential_type: 'card',
          amount: DEMO_CARD_AMOUNT,
          context: DEMO_CARD_CONTEXT,
          merchant_name: DEMO_MERCHANT_NAME,
          merchant_url: DEMO_MERCHANT_URL,
          request_approval: true,
          test: true,
        });
        setSpendRequest(result);

        setStep('await-approval');
        await pollUntilApproved(spendRequestRepo, result.id);
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

  const pmLabel = paymentMethod
    ? `${paymentMethod.card_details?.brand ?? paymentMethod.type} ****${paymentMethod.card_details?.last4 ?? ''}`
    : '';

  const card = spendRequest?.card;
  const pastStep = (target: Step) => {
    const order: Step[] = [
      'intro',
      'fetch-pm',
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

      {/* Intro */}
      <Box flexDirection="column">
        <Text>{C.intro.description}</Text>
        <Box marginTop={1}>
          <Text>
            Here's what will happen:{'\n'}
            {C.intro.steps.map((s, i) => ` ${i + 1}. ${s}`).join('\n')}
          </Text>
        </Box>
        {step === 'intro' && prompt(C.intro.prompt)}
      </Box>

      {/* Fetch payment methods (only when running standalone without onboard) */}
      {step === 'fetch-pm' && (
        <Box flexDirection="column">
          <Text dimColor>
            Fetching payment methods from your Link wallet...
          </Text>
        </Box>
      )}

      {pastStep('fetch-pm') && paymentMethod && (
        <Box flexDirection="column">
          <Text color="green">
            ✓ Using <Text bold>{pmLabel}</Text>
            {paymentMethod.is_default ? ' (default)' : ''}
          </Text>
          {step === 'explain-pm' && prompt()}
        </Box>
      )}

      {/* Step 2: Create spend request */}
      {pastStep('explain-pm') && (
        <Box flexDirection="column">
          <Text dimColor>{C.createSpend.description}</Text>
          {step === 'create-spend' && (
            <Box marginY={1}>
              <Text color="cyan">{C.createSpend.loading}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Step 2 result + Step 3: approval */}
      {(step === 'await-approval' || pastStep('await-approval')) &&
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
                amount: spendRequest.amount,
                merchant_name: spendRequest.merchant_name,
                approval_url: spendRequest.approval_url,
              }}
            />
          </Box>
        )}

      {step === 'await-approval' && (
        <Box flexDirection="column">
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
        </Box>
      )}

      {/* Step 4: Show card */}
      {pastStep('await-approval') && card && (
        <Box flexDirection="column">
          <Text color="green">✓ Approved!</Text>
          <Text>{C.showCard.description}</Text>
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="green"
            paddingX={2}
            paddingY={1}
            marginTop={1}
          >
            <Text>
              Number: <Text bold>{formatCardNumber(card.number)}</Text>
            </Text>
            <Text>
              Exp:{' '}
              <Text bold>{formatExpiry(card.exp_month, card.exp_year)}</Text>
            </Text>
            <Text>
              CVC: <Text bold>{card.cvc}</Text>
            </Text>
            {card.billing_address?.postal_code && (
              <Text>
                Zip: <Text bold>{card.billing_address.postal_code}</Text>
              </Text>
            )}
            {card.valid_until && (
              <Text dimColor>
                Expires:{' '}
                {new Date(card.valid_until * 1000).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </Box>

          <Box marginTop={1}>
            <Text>{C.showCard.openUrl}</Text>
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
