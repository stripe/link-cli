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
export type Step =
  | 'probing'
  | 'creating'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'done';

declare const __CLI_VERSION__: string;

export function buildHeaders(
  data: string | undefined,
  headers: string[] | undefined,
): Headers {
  const result = new Headers();
  if (data !== undefined) result.set('Content-Type', 'application/json');
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
        ...(method !== undefined && { method }),
        ...(data !== undefined && { body: data }),
        headers: buildHeaders(data, headers),
      },
      { spendRequestId },
    ),
  );
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
  spendRequests: ISpendRequestResource;
  paymentMethodsFactory: () => IPaymentMethodsResource;
  onStep?: (step: Step) => void;
  onApprovalUrl?: (url: string) => void;
}

export async function runMppPayFullFlow(
  options: MppPayFullFlowOptions,
): Promise<PayResult> {
  const requestHeaders = buildHeaders(options.data, options.headers);
  const mppRequest = {
    url: options.url,
    ...(options.method !== undefined && { method: options.method }),
    ...(options.data !== undefined && { body: options.data }),
    headers: requestHeaders,
  };

  options.onStep?.('probing');
  const decoded = await options.mpp.decode(mppRequest);
  if (!decoded.payment_required) return sanitizeDeep(decoded.response);

  const challenge = decoded.challenges[0];
  if (!challenge) {
    throw new Error(
      'WWW-Authenticate header does not include a supported stripe charge or session challenge',
    );
  }
  const networkId = challenge.network_id;
  const challengeAmount = challenge.request_json.amount
    ? Number(challenge.request_json.amount)
    : undefined;
  const challengeCurrency =
    (challenge.request_json.currency as string) ?? 'usd';

  const amount = options.amountOverride ?? challengeAmount;
  if (
    options.amountOverride !== undefined &&
    challengeAmount !== undefined &&
    options.amountOverride !== challengeAmount
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

  let paymentMethodId = options.paymentMethodId;
  if (!paymentMethodId) {
    options.onStep?.('creating');
    const methods = await options.paymentMethodsFactory().list();
    const paymentMethod = methods[0];
    if (!paymentMethod) {
      throw new Error(
        'No payment methods found. Add one with `link-cli payment-methods add`.',
      );
    }
    paymentMethodId = paymentMethod.id;
  }

  options.onStep?.('creating');
  const createParams = {
    payment_details: paymentMethodId,
    credential_type: 'shared_payment_token' as const,
    network_id: networkId,
    amount,
    currency: challengeCurrency,
    context: options.context,
    request_approval: true,
    test: options.test || undefined,
    approve: options.approve || options.useApprovalPolicy || undefined,
    use_approval_policy: options.useApprovalPolicy || undefined,
  };
  const spendRequest = await options.spendRequests.create(createParams);

  let approved = spendRequest;
  if (spendRequest.status !== 'approved') {
    options.onStep?.('approving');
    if (spendRequest.approval_url) {
      options.onApprovalUrl?.(spendRequest.approval_url);
    }
    approved = await pollUntilApproved(options.spendRequests, spendRequest.id);
    if (approved.status !== 'approved') {
      throw new Error(
        `Spend request was not approved (status: ${approved.status})`,
      );
    }
  }

  options.onStep?.('signing');
  options.onStep?.('submitting');
  const result = await options.mpp.pay(mppRequest, {
    spendRequestId: approved.id,
  });
  options.onStep?.('done');
  return sanitizeDeep(result);
}

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
  spendRequests,
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
  spendRequests: ISpendRequestResource;
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
            spendRequests,
            paymentMethodsFactory,
            onStep: setStep,
            onApprovalUrl: setApprovalUrl,
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
    spendRequests,
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
  if (error) return <Text color="red">Error: {error}</Text>;
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
