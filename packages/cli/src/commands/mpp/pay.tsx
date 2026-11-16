import type {
  IMppResource,
  IPaymentMethodsResource,
  ISpendRequestResource,
  MppPaymentResult,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { sanitizeDeep } from '../../utils/sanitize-text';
import { buildUserAgent } from '../../utils/user-agent';

export type PayResult = MppPaymentResult;

declare const __CLI_VERSION__: string;

export function buildHeaders(
  data: string | undefined,
  headers: string[] | undefined,
): Headers {
  const result = new Headers();
  if (data !== undefined) {
    result.set('Content-Type', 'application/json');
  }
  for (const line of headers ?? []) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result.set(key, value);
  }
  if (!result.has('user-agent')) {
    result.set('User-Agent', buildUserAgent(__CLI_VERSION__, process.env));
  }
  return result;
}

export interface MppPayFullFlowOptions {
  url: string;
  method: string | undefined;
  data: string | undefined;
  headers: string[] | undefined;
  context: string;
  amountOverride: number | undefined;
  paymentMethodId: string | undefined;
  test: boolean;
  approve: boolean;
  useApprovalPolicy?: boolean;
  mpp: IMppResource;
  repository: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  onStep?: (step: Step) => void;
  onApprovalUrl?: (url: string) => void;
}

export async function runMppPayWithSpendRequest(
  url: string,
  spendRequestId: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  mpp: IMppResource,
): Promise<PayResult> {
  return sanitizeDeep(
    await mpp.pay(
      {
        url,
        method,
        body: data,
        headers: buildHeaders(data, headers),
      },
      { spendRequestId },
    ),
  );
}

export async function runMppPayFullFlow(
  opts: MppPayFullFlowOptions,
): Promise<PayResult> {
  const {
    url,
    method,
    data,
    headers,
    context,
    amountOverride,
    paymentMethodId,
    test,
    approve,
    useApprovalPolicy,
    mpp,
    repository,
    paymentMethodsFactory,
    onStep,
    onApprovalUrl,
  } = opts;

  const requestHeaders = buildHeaders(data, headers);

  // 1. Probe URL
  onStep?.('probing');
  const probe = await mpp.decode({
    url,
    method,
    body: data,
    headers: requestHeaders,
  });

  if (!probe.payment_required) {
    return sanitizeDeep(probe.response);
  }

  // 2. Parse challenge
  const decoded = probe.challenges[0];
  const networkId = decoded.network_id;
  const challengeAmount = decoded.request_json.amount
    ? Number(decoded.request_json.amount)
    : undefined;
  const challengeCurrency = (decoded.request_json.currency as string) ?? 'usd';

  const amount = amountOverride ?? challengeAmount;
  if (
    amountOverride !== undefined &&
    challengeAmount !== undefined &&
    amountOverride !== challengeAmount
  ) {
    throw new Error(
      `--amount must match the MPP challenge amount (${challengeAmount})`,
    );
  }
  if (!amount) {
    throw new Error(
      'Could not determine amount from 402 challenge. Pass --amount explicitly.',
    );
  }

  // 3. Get payment method
  let pmId = paymentMethodId;
  if (!pmId) {
    onStep?.('creating');
    const pmResource = paymentMethodsFactory();
    const methods = await pmResource.list();
    if (!methods.length) {
      throw new Error(
        'No payment methods found. Add one with `link-cli payment-methods add`.',
      );
    }
    pmId = methods[0].id;
  }

  // 4. Create spend request
  onStep?.('creating');
  const createParams = {
    payment_details: pmId,
    credential_type: 'shared_payment_token' as const,
    network_id: networkId,
    amount,
    currency: challengeCurrency,
    context,
    request_approval: true,
    test: test || undefined,
    approve: approve || useApprovalPolicy || undefined,
    use_approval_policy: useApprovalPolicy || undefined,
  };
  const spendRequest = await repository.create(createParams);

  // 5. Poll for approval
  onStep?.('approving');
  if (spendRequest.approval_url) {
    onApprovalUrl?.(spendRequest.approval_url);
  }

  const approved = await pollUntilApproved(repository, spendRequest.id);
  if (approved.status !== 'approved') {
    throw new Error(
      `Spend request was not approved (status: ${approved.status})`,
    );
  }

  // 6. Pay
  onStep?.('signing');
  onStep?.('submitting');
  return sanitizeDeep(
    await mpp.pay(probe.request, { spendRequestId: spendRequest.id }),
  );
}

export type Step =
  | 'probing'
  | 'creating'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'done';

export function MppApprovalPrompt({ approvalUrl }: { approvalUrl: string }) {
  useInput((_input, key) => {
    if (key.return) openUrl(approvalUrl);
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginTop={1}
    >
      <Text>
        Approve in Link app:{' '}
        <Text bold color="cyan">
          {approvalUrl}
        </Text>
      </Text>
      <Text dimColor>Press Enter to open in browser</Text>
    </Box>
  );
}

export function MppPay({
  url,
  spendRequestId,
  method,
  data,
  headers,
  context,
  amountOverride,
  paymentMethodId,
  test,
  approve,
  useApprovalPolicy,
  mpp,
  repository,
  paymentMethodsFactory,
  onComplete,
}: {
  url: string;
  spendRequestId?: string;
  method?: string;
  data?: string;
  headers?: string[];
  context?: string;
  amountOverride?: number;
  paymentMethodId?: string;
  test?: boolean;
  approve?: boolean;
  useApprovalPolicy?: boolean;
  mpp: IMppResource;
  repository: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  onComplete: (result: PayResult | null) => void;
}) {
  const [step, setStep] = useState<Step>(
    spendRequestId ? 'signing' : 'probing',
  );
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let payResult: PayResult;

        if (spendRequestId) {
          setStep('signing');
          payResult = await runMppPayWithSpendRequest(
            url,
            spendRequestId,
            method,
            data,
            headers,
            mpp,
          );
        } else {
          if (!context) {
            throw new Error(
              '--context is required for the full MPP flow (min 100 chars)',
            );
          }
          payResult = await runMppPayFullFlow({
            url,
            method,
            data,
            headers,
            context,
            amountOverride,
            paymentMethodId,
            test: test ?? false,
            approve: approve ?? false,
            useApprovalPolicy: useApprovalPolicy ?? false,
            mpp,
            repository,
            paymentMethodsFactory,
            onStep: setStep,
            onApprovalUrl: (u) => setApprovalUrl(u),
          });
        }

        setResult(payResult);
        setStep('done');
        onComplete(payResult);
      } catch (err) {
        setError((err as Error).message);
        onComplete(null);
      }
    })();
  }, [
    url,
    spendRequestId,
    method,
    data,
    headers,
    context,
    amountOverride,
    paymentMethodId,
    test,
    approve,
    useApprovalPolicy,
    mpp,
    repository,
    paymentMethodsFactory,
    onComplete,
  ]);

  const stepLabels: Record<Step, string> = {
    probing: 'Probing URL for 402 challenge',
    creating: 'Creating spend request',
    approving: 'Waiting for approval',
    signing: 'Signing credential',
    submitting: 'Submitting payment',
    done: 'Done',
  };

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  return (
    <Box flexDirection="column">
      {step !== 'done' && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan">
              <Spinner type="dots" /> {stepLabels[step]}...
            </Text>
          </Box>
          {step === 'approving' && approvalUrl && (
            <MppApprovalPrompt approvalUrl={approvalUrl} />
          )}
        </Box>
      )}
      {result && (
        <Box flexDirection="column">
          <Text
            color={
              result.status >= 400
                ? 'red'
                : result.status >= 300
                  ? 'yellow'
                  : 'green'
            }
          >
            HTTP {result.status}
          </Text>
          <Text>{result.body}</Text>
        </Box>
      )}
    </Box>
  );
}
