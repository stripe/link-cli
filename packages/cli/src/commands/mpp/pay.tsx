import type {
  IPaymentMethodsResource,
  ISpendRequestResource,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Credential, Method } from 'mppx';
import { Mppx, Transport } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import React, { useEffect, useState } from 'react';
import { pollUntilApproved } from '../../utils/poll-until-approved';
import {
  decodeStripeChallenge,
  getStripeChargeChallengeFromResponse,
} from './decode';

export type PayResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export function buildHeaders(
  data: string | undefined,
  headers: string[] | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (data !== undefined) {
    result['Content-Type'] = 'application/json';
  }
  for (const line of headers ?? []) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export async function readPayResult(response: Response): Promise<PayResult> {
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const body = await response.text();
  return { status: response.status, headers: responseHeaders, body };
}

function createStripePaymentClient(spt: string) {
  const stripeCharge = Method.toClient(StripeMethods.charge, {
    async createCredential({ challenge }) {
      return Credential.serialize({
        challenge,
        payload: { spt },
      });
    },
  });

  const stripeSession = Method.toClient(
    { ...StripeMethods.charge, intent: 'session' as const },
    {
      async createCredential({ challenge }) {
        return Credential.serialize({
          challenge,
          payload: { action: 'open', grantedToken: spt },
        });
      },
    },
  );

  return Mppx.create({
    methods: [stripeCharge, stripeSession],
    polyfill: false,
    transport: Transport.from<RequestInit, Response>({
      name: 'stripe-http',
      isPaymentRequired(response) {
        return response.status === 402;
      },
      getChallenge(response) {
        return getStripeChargeChallengeFromResponse(response);
      },
      setCredential(request, credential) {
        const nextHeaders = new Headers(request.headers);
        nextHeaders.set('Authorization', credential);
        return { ...request, headers: nextHeaders };
      },
    }),
  });
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
  repository: ISpendRequestResource,
): Promise<PayResult> {
  const spendRequest = await repository.getSpendRequest(spendRequestId, {
    include: ['shared_payment_token'],
  });

  if (!spendRequest) {
    throw new Error(`Spend request ${spendRequestId} not found`);
  }
  if (spendRequest.credential_type !== 'shared_payment_token') {
    const type = spendRequest.credential_type ?? 'card';
    throw new Error(
      `Spend request ${spendRequestId} must have credential_type 'shared_payment_token' (current: '${type}')`,
    );
  }
  if (spendRequest.status !== 'approved') {
    throw new Error(
      `Spend request must be approved (current status: ${spendRequest.status})`,
    );
  }
  if (!spendRequest.shared_payment_token) {
    throw new Error('Spend request does not have a shared payment token');
  }

  return payWithSpt(
    url,
    spendRequest.shared_payment_token.id,
    method,
    data,
    headers,
  );
}

export async function payWithSpt(
  url: string,
  spt: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
): Promise<PayResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  const initialResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: requestHeaders,
  });

  if (initialResponse.status !== 402) {
    return readPayResult(initialResponse);
  }

  const authHeader =
    await createStripePaymentClient(spt).createCredential(initialResponse);

  const retryResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: {
      ...requestHeaders,
      Authorization: authHeader,
    },
  });

  return readPayResult(retryResponse);
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
    repository,
    paymentMethodsFactory,
    onStep,
    onApprovalUrl,
  } = opts;

  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  // 1. Probe URL
  onStep?.('probing');
  const probeResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: requestHeaders,
  });

  if (probeResponse.status !== 402) {
    return readPayResult(probeResponse);
  }

  // 2. Parse challenge
  const wwwAuth = probeResponse.headers.get('www-authenticate');
  if (!wwwAuth) {
    throw new Error('URL returned 402 but no WWW-Authenticate header');
  }

  const decoded = decodeStripeChallenge(wwwAuth);
  const networkId = decoded.network_id;
  const challengeAmount = decoded.request_json.amount
    ? Number(decoded.request_json.amount)
    : undefined;
  const challengeCurrency = (decoded.request_json.currency as string) ?? 'usd';

  const amount = amountOverride ?? challengeAmount;
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
  const spendRequest = await repository.createSpendRequest({
    payment_details: pmId,
    credential_type: 'shared_payment_token',
    network_id: networkId,
    amount,
    currency: challengeCurrency,
    context,
    request_approval: true,
    test: test || undefined,
  });

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

  // 6. Retrieve with SPT (retry briefly in case of propagation delay)
  onStep?.('signing');
  let withSpt = await repository.getSpendRequest(spendRequest.id, {
    include: ['shared_payment_token'],
  });
  for (let i = 0; i < 3 && withSpt && !withSpt.shared_payment_token; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    withSpt = await repository.getSpendRequest(spendRequest.id, {
      include: ['shared_payment_token'],
    });
  }
  if (!withSpt?.shared_payment_token) {
    throw new Error('Failed to retrieve shared payment token');
  }

  // 7. Pay
  onStep?.('submitting');
  return payWithSpt(
    url,
    withSpt.shared_payment_token.id,
    method,
    data,
    headers,
  );
}

export type Step =
  | 'probing'
  | 'creating'
  | 'approving'
  | 'signing'
  | 'submitting'
  | 'done';

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
            repository,
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
            <Box marginTop={1} paddingX={2}>
              <Text>
                Approve in Link app:{' '}
                <Text bold color="blue">
                  {approvalUrl}
                </Text>
              </Text>
            </Box>
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
