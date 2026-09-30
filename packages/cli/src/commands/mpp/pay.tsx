import type {
  IMppResource,
  ISpendRequestResource,
  MppPaymentResult,
  SpendRequest,
} from '@stripe/link-sdk';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { openUrl } from '../../utils/open-url';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import { sanitizeDeep } from '../../utils/sanitize-text';

export type PayResult = MppPaymentResult;
export type Step =
  | 'probing'
  | 'creating'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'done';

interface CliMppRequestOptions {
  url: string;
  method?: string;
  body?: string;
  headers?: HeadersInit;
}

export interface CliMppResource extends IMppResource {
  createSpendRequest(
    options: CliMppRequestOptions & {
      context: string;
      amount?: number;
      paymentMethodId?: string;
      test?: boolean;
      onStep?: (step: Step) => void;
    },
  ): Promise<
    | MppPaymentResult
    | {
        spendRequest: SpendRequest;
        request: {
          url: string;
          method: string;
          headers: Record<string, string>;
          body?: string;
        };
        approvedChallenge: string;
      }
  >;
}

declare const __CLI_VERSION__: string;

export function buildHeaders(
  data: string | undefined,
  headers: string[] | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (data !== undefined) result['Content-Type'] = 'application/json';
  for (const line of headers ?? []) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  if (!Object.keys(result).some((key) => key.toLowerCase() === 'user-agent')) {
    result['User-Agent'] = `link-cli/${__CLI_VERSION__}`;
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
  approvedChallenge?: string,
): Promise<PayResult> {
  return sanitizeDeep(
    await mpp.pay({
      url,
      spendRequestId,
      ...(method !== undefined && { method }),
      ...(data !== undefined && { body: data }),
      headers: buildHeaders(data, headers),
      ...(approvedChallenge !== undefined && { challenge: approvedChallenge }),
    }),
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
  mpp: CliMppResource;
  spendRequests: ISpendRequestResource;
  onStep?: (step: Step) => void;
  onApprovalUrl?: (url: string) => void;
}

export async function runMppPayFullFlow(
  options: MppPayFullFlowOptions,
): Promise<PayResult> {
  const prepared = await options.mpp.createSpendRequest({
    url: options.url,
    ...(options.method !== undefined && { method: options.method }),
    ...(options.data !== undefined && { body: options.data }),
    headers: buildHeaders(options.data, options.headers),
    context: options.context,
    ...(options.amountOverride !== undefined && {
      amount: options.amountOverride,
    }),
    ...(options.paymentMethodId !== undefined && {
      paymentMethodId: options.paymentMethodId,
    }),
    test: options.test,
    ...(options.onStep !== undefined && { onStep: options.onStep }),
  });
  if (!('spendRequest' in prepared)) return sanitizeDeep(prepared);

  options.onStep?.('approving');
  if (prepared.spendRequest.approval_url) {
    options.onApprovalUrl?.(prepared.spendRequest.approval_url);
  }
  const approved = await pollUntilApproved(
    options.spendRequests,
    prepared.spendRequest.id,
  );
  if (approved.status !== 'approved') {
    throw new Error(
      `Spend request was not approved (status: ${approved.status})`,
    );
  }

  options.onStep?.('signing');
  options.onStep?.('submitting');
  const result = await options.mpp.pay({
    ...prepared.request,
    spendRequestId: prepared.spendRequest.id,
    challenge: prepared.approvedChallenge,
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
  mpp,
  spendRequests,
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
  mpp: CliMppResource;
  spendRequests: ISpendRequestResource;
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
            mpp,
            spendRequests,
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
    mpp,
    spendRequests,
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
