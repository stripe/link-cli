import { Challenge } from 'mppx';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import type { DecodedStripeChallenge } from './decode';
import { decodeStripeChallenge } from './decode';

export type InspectResult = {
  status: number;
  headers: Record<string, string>;
  payment_required: boolean;
  challenge?: DecodedStripeChallenge;
  network_id?: string;
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

export async function runMppInspect(
  url: string,
  method: string | undefined,
  data: string | undefined,
  headers: string[] | undefined,
): Promise<InspectResult> {
  const httpMethod = method ?? (data !== undefined ? 'POST' : 'GET');
  const requestHeaders = buildHeaders(data, headers);

  const response = await fetch(url, {
    method: httpMethod,
    body: data,
    headers: requestHeaders,
  });

  const responseHeaders = Object.fromEntries(response.headers.entries());
  const paymentRequired = response.status === 402;

  let challenge: DecodedStripeChallenge | undefined;
  let networkId: string | undefined;

  if (paymentRequired) {
    const wwwAuth = response.headers.get('www-authenticate');
    if (wwwAuth) {
      try {
        challenge = decodeStripeChallenge(wwwAuth);
        networkId = challenge.network_id;
      } catch {
        // Challenge present but not a valid stripe charge challenge
      }
    }
  }

  const result: InspectResult = {
    status: response.status,
    headers: responseHeaders,
    payment_required: paymentRequired,
  };

  if (challenge) result.challenge = challenge;
  if (networkId) result.network_id = networkId;

  return result;
}

export function MppInspect({
  url,
  method,
  data,
  headers,
  onComplete,
}: {
  url: string;
  method?: string;
  data?: string;
  headers?: string[];
  onComplete: (result: InspectResult | null) => void;
}) {
  const [result, setResult] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const inspectResult = await runMppInspect(url, method, data, headers);
        setResult(inspectResult);
        onComplete(inspectResult);
      } catch (err) {
        setError((err as Error).message);
        onComplete(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [url, method, data, headers, onComplete]);

  if (error) {
    return <Text color="red">Error: {error}</Text>;
  }

  if (loading) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Inspecting URL...
        </Text>
      </Box>
    );
  }

  if (!result) return null;

  return (
    <Box flexDirection="column">
      <Text
        color={
          result.status >= 400
            ? result.payment_required
              ? 'yellow'
              : 'red'
            : 'green'
        }
      >
        HTTP {result.status}
        {result.payment_required ? ' (Payment Required)' : ''}
      </Text>
      {result.challenge && (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text color="green">✓ Stripe challenge found</Text>
          <Text>
            Network ID: <Text bold>{result.network_id}</Text>
          </Text>
          <Text>
            Challenge ID: <Text bold>{result.challenge.id}</Text>
          </Text>
          <Text>
            Realm: <Text bold>{result.challenge.realm}</Text>
          </Text>
          <Text>Request JSON:</Text>
          <Text>{JSON.stringify(result.challenge.request_json, null, 2)}</Text>
        </Box>
      )}
      {result.payment_required && !result.challenge && (
        <Box marginTop={1} paddingX={2}>
          <Text color="yellow">
            402 response but no valid Stripe charge challenge found in
            WWW-Authenticate header
          </Text>
        </Box>
      )}
    </Box>
  );
}
