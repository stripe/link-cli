import type {
  ISpendRequestResource,
  IWebBotAuthResource,
} from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Credential, Method } from 'mppx';
import { Mppx, Transport } from 'mppx/client';
import { Methods as StripeMethods } from 'mppx/stripe';
import React, { useEffect, useState } from 'react';
import { getStripeChargeChallengeFromResponse } from './decode';

export type PayResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function buildHeaders(
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

async function readPayResult(response: Response): Promise<PayResult> {
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

  return Mppx.create({
    methods: [stripeCharge],
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

const WBA_TIMEOUT_MS = 3_000;

// Fetches Web Bot Auth headers with a timeout. Returns empty object on any
// failure so callers can proceed without bot-bypass rather than hard-failing.
async function tryGetBotAuthHeaders(
  webBotAuth: IWebBotAuthResource,
  url: string,
): Promise<Record<string, string>> {
  try {
    const block = await Promise.race([
      webBotAuth.getHeaders(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), WBA_TIMEOUT_MS),
      ),
    ]);
    return {
      Signature: block.signature,
      'Signature-Input': block.signature_input,
    };
  } catch {
    return {};
  }
}

// NOTE: The multi-step payment flow (WBA prefetch → probe → SPT sign → retry)
// is implemented twice: once here for agent/format mode, and again inside the
// MppPay component below for interactive mode. They must be kept in sync.
// The right fix is to extract a shared flow that accepts progress callbacks,
// but that refactor belongs in a separate PR.
export async function runMppPay(
  url: string,
  spendRequestId: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  repository: ISpendRequestResource,
  webBotAuth: IWebBotAuthResource,
): Promise<PayResult> {
  // 1. Retrieve the approved spend request with SPT
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
  const spt = spendRequest.shared_payment_token.id;

  // 2. Determine method
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  // 3. Fetch Web Bot Auth headers proactively (gracefully skipped on failure/timeout)
  const botAuthHeaders = await tryGetBotAuthHeaders(webBotAuth, url);

  // 4. Probe the URL with WBA headers included
  const probeResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: { ...requestHeaders, ...botAuthHeaders },
  });

  // 5. If not 402, return as-is
  if (probeResponse.status !== 402) {
    return readPayResult(probeResponse);
  }

  // 6. Sign the 402 challenge with SPT
  const authHeader =
    await createStripePaymentClient(spt).createCredential(probeResponse);

  // 7. Retry with SPT credential (WBA headers carried through)
  const retryResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: {
      ...requestHeaders,
      ...botAuthHeaders,
      Authorization: authHeader,
    },
  });

  return readPayResult(retryResponse);
}

type Step = 'retrieving' | 'probing' | 'signing' | 'submitting' | 'done';

export function MppPay({
  url,
  spendRequestId,
  method,
  data,
  headers,
  repository,
  webBotAuth,
  onComplete,
}: {
  url: string;
  spendRequestId: string;
  method?: string;
  data?: string;
  headers?: string[];
  repository: ISpendRequestResource;
  webBotAuth: IWebBotAuthResource;
  onComplete: (result: PayResult | null) => void;
}) {
  const [step, setStep] = useState<Step>('retrieving');
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStep('retrieving');
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

        const spt = spendRequest.shared_payment_token.id;
        const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
        const requestHeaders = buildHeaders(data, headers);

        setStep('probing');
        const botAuthHeaders = await tryGetBotAuthHeaders(webBotAuth, url);
        const probeResponse = await fetch(url, {
          method: httpMethod,
          body: data,
          headers: { ...requestHeaders, ...botAuthHeaders },
        });

        if (probeResponse.status !== 402) {
          const payResult = await readPayResult(probeResponse);
          setResult(payResult);
          setStep('done');
          onComplete(payResult);
          return;
        }

        setStep('signing');
        const authHeader =
          await createStripePaymentClient(spt).createCredential(probeResponse);

        setStep('submitting');
        const retryResponse = await fetch(url, {
          method: httpMethod,
          body: data,
          headers: {
            ...requestHeaders,
            ...botAuthHeaders,
            Authorization: authHeader,
          },
        });

        const payResult = await readPayResult(retryResponse);
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
    repository,
    webBotAuth,
    onComplete,
  ]);

  const stepLabels: Record<Step, string> = {
    retrieving: 'Retrieving spend request',
    probing: 'Probing URL',
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
        <Box>
          <Text color="cyan">
            <Spinner type="dots" /> {stepLabels[step]}...
          </Text>
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
