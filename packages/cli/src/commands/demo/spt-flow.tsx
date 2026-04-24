import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { decodeStripeChallenge } from '../mpp/decode';
import { type PayResult, runMppPay } from '../mpp/pay';
import {
  DEMO_CLIMATE_API_URL,
  DEMO_SPT_AMOUNT,
  DEMO_SPT_CONTEXT,
} from './constants';
import { SPT_FLOW as S } from './content';
import { StepData } from './step-data';

type Step =
  | 'intro'
  | 'fetch-pm'
  | 'probe'
  | 'explain-402'
  | 'create-spend'
  | 'await-approval'
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
  const [spendRequest, setSpendRequest] = useState<SpendRequest | null>(null);
  const [payResult, setPayResult] = useState<PayResult | null>(null);
  const [challengeData, setChallengeData] = useState<Record<
    string,
    unknown
  > | null>(null);
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

        let pmId = initialPaymentMethodId;
        if (!pmId) {
          setStep('fetch-pm');
          const methods = await paymentMethodsResource.listPaymentMethods();
          if (methods.length === 0) {
            throw new Error(
              'No payment methods found. Open the Link app (link.com) and add a card to your wallet, then run the demo again.',
            );
          }
          const pm = methods.find((m) => m.is_default) ?? methods[0];
          pmId = pm.id;
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
        const result = await spendRequestRepo.createSpendRequest({
          payment_details: pmId,
          credential_type: 'shared_payment_token',
          network_id: decoded.network_id,
          amount: DEMO_SPT_AMOUNT,
          context: DEMO_SPT_CONTEXT,
          request_approval: true,
          test: true,
        });
        setSpendRequest(result);

        setStep('await-approval');
        const approved = await pollUntilApproved(spendRequestRepo, result.id);
        setSpendRequest(approved);

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

      {pastStep('fetch-pm') && (
        <Box flexDirection="column">
          <Text dimColor>{S.probe.description}</Text>
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
          <Text dimColor>{S.createSpend.description}</Text>
          {step === 'create-spend' && (
            <Box marginY={1}>
              <Text color="cyan">{S.createSpend.loading}</Text>
            </Box>
          )}
        </Box>
      )}

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
                network_id: spendRequest.network_id,
                amount: spendRequest.amount,
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
          <Box marginY={1}>
            <Text color="cyan">{S.approval.loading}</Text>
          </Box>
        </Box>
      )}

      {pastStep('await-approval') && step !== 'error' && (
        <Box flexDirection="column">
          {(step === 'mpp-pay-gate' || pastStep('mpp-pay-gate')) && (
            <>
              <Text color="green">✓ Approved!</Text>
              <Text dimColor>{S.mppPay.description}</Text>
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
            {payResult.body && <Text dimColor>{payResult.body}</Text>}
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
