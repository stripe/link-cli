import type { ISpendRequestResource } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Challenge, Credential } from 'mppx';
import React, { useEffect, useState } from 'react';
import { outputError } from '../../utils/execute-command';
import { decodeStripeChallenge } from './decode';

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

export async function runMppPay(
  url: string,
  spendRequestId: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
  repository: ISpendRequestResource,
): Promise<PayResult> {
  // 1. Retrieve the approved spend request with SPT
  const spendRequest = await repository.getSpendRequest(spendRequestId, {
    include: ['shared_payment_token'],
  });

  if (!spendRequest) {
    outputError(`Spend request ${spendRequestId} not found`);
  }
  if (
    (spendRequest as NonNullable<typeof spendRequest>).credential_type !==
    'shared_payment_token'
  ) {
    const type =
      (spendRequest as NonNullable<typeof spendRequest>).credential_type ??
      'card';
    outputError(
      `Spend request ${spendRequestId} must have credential_type 'shared_payment_token' (current: '${type}')`,
    );
  }
  if (
    (spendRequest as NonNullable<typeof spendRequest>).status !== 'approved'
  ) {
    outputError(
      `Spend request must be approved (current status: ${(spendRequest as NonNullable<typeof spendRequest>).status})`,
    );
  }
  const sptObj = (spendRequest as NonNullable<typeof spendRequest>)
    .shared_payment_token;
  if (!sptObj) {
    outputError('Spend request does not have a shared payment token');
  }
  const spt = (sptObj as NonNullable<typeof sptObj>).id;

  // 2. Determine method
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  // 3. Make the initial request
  const initialResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: requestHeaders,
  });

  // 4. If not 402, return as-is
  if (initialResponse.status !== 402) {
    const responseHeaders = Object.fromEntries(
      initialResponse.headers.entries(),
    );
    const body = await initialResponse.text();
    return { status: initialResponse.status, headers: responseHeaders, body };
  }

  // 5. Parse challenges, find stripe
  const decoded = decodeStripeChallenge(
    initialResponse.headers.get('www-authenticate') ?? '',
  );
  const stripeChallenge = Challenge.from({
    id: decoded.id,
    realm: decoded.realm,
    method: decoded.method,
    intent: decoded.intent,
    request: decoded.request_json,
    ...(decoded.description ? { description: decoded.description } : {}),
    ...(decoded.digest ? { digest: decoded.digest } : {}),
    ...(decoded.expires ? { expires: decoded.expires } : {}),
  });

  // 6. Build and serialize credential
  const credential = Credential.from({
    challenge: stripeChallenge,
    payload: { spt },
  });
  const authHeader = Credential.serialize(credential);

  // 7. Retry with Authorization header
  const retryResponse = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: {
      ...requestHeaders,
      Authorization: authHeader,
    },
  });

  if (!retryResponse.ok) {
    const body = await retryResponse.text();
    outputError(
      `Payment submission failed with status ${retryResponse.status}: ${body}`,
    );
  }

  const responseHeaders = Object.fromEntries(retryResponse.headers.entries());
  const body = await retryResponse.text();
  return { status: retryResponse.status, headers: responseHeaders, body };
}

type Step = 'retrieving' | 'probing' | 'signing' | 'submitting' | 'done';

export function MppPay({
  url,
  spendRequestId,
  method,
  data,
  headers,
  repository,
  onComplete,
}: {
  url: string;
  spendRequestId: string;
  method?: string;
  data?: string;
  headers?: string[];
  repository: ISpendRequestResource;
  onComplete: () => void;
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
        const initialResponse = await fetch(url, {
          method: httpMethod,
          body: data,
          headers: requestHeaders,
        });

        if (initialResponse.status !== 402) {
          const responseHeaders = Object.fromEntries(
            initialResponse.headers.entries(),
          );
          const body = await initialResponse.text();
          setResult({
            status: initialResponse.status,
            headers: responseHeaders,
            body,
          });
          setStep('done');
          onComplete();
          return;
        }

        setStep('signing');
        const decoded = decodeStripeChallenge(
          initialResponse.headers.get('www-authenticate') ?? '',
        );
        const stripeChallenge = Challenge.from({
          id: decoded.id,
          realm: decoded.realm,
          method: decoded.method,
          intent: decoded.intent,
          request: decoded.request_json,
          ...(decoded.description ? { description: decoded.description } : {}),
          ...(decoded.digest ? { digest: decoded.digest } : {}),
          ...(decoded.expires ? { expires: decoded.expires } : {}),
        });

        const credential = Credential.from({
          challenge: stripeChallenge,
          payload: { spt },
        });
        const authHeader = Credential.serialize(credential);

        setStep('submitting');
        const retryResponse = await fetch(url, {
          method: httpMethod,
          body: data,
          headers: {
            ...requestHeaders,
            Authorization: authHeader,
          },
        });

        const responseHeaders = Object.fromEntries(
          retryResponse.headers.entries(),
        );
        const body = await retryResponse.text();
        setResult({
          status: retryResponse.status,
          headers: responseHeaders,
          body,
        });
        setStep('done');
        onComplete();
      } catch (err) {
        setError((err as Error).message);
        onComplete();
      }
    })();
  }, [url, spendRequestId, method, data, headers, repository, onComplete]);

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
          <Text color="green">HTTP {result.status}</Text>
          <Text>{result.body}</Text>
        </Box>
      )}
    </Box>
  );
}
