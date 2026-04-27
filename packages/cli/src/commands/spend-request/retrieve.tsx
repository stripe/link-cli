import type { ISpendRequestResource, SpendRequest } from '@stripe/link-sdk';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

interface RetrieveSpendRequestProps {
  repository: ISpendRequestResource;
  id: string;
  timeout?: number;
  include?: string[];
  onComplete: () => void;
}

type Phase =
  | 'fetching'
  | 'polling'
  | 'success'
  | 'declined'
  | 'timeout'
  | 'error';

export const RetrieveSpendRequest: React.FC<RetrieveSpendRequestProps> = ({
  repository,
  id,
  timeout = 300,
  include,
  onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('fetching');
  const [request, setRequest] = useState<SpendRequest | null>(null);
  const [error, setError] = useState<string>('');
  const [elapsed, setElapsed] = useState<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await repository.getSpendRequest(id, { include });
        if (!result) {
          setError(`Spend request ${id} not found`);
          setPhase('error');
          setTimeout(onComplete, 1500);
          return;
        }

        setRequest(result);

        if (result.status === 'approved') {
          setPhase('success');
          setTimeout(onComplete, 1500);
        } else if (result.status === 'denied') {
          setPhase('declined');
          setTimeout(onComplete, 1500);
        } else {
          startTimeRef.current = Date.now();
          setPhase('polling');
        }
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
        setTimeout(onComplete, 1500);
      }
    };

    fetch();
  }, [repository, id, include, onComplete]);

  useEffect(() => {
    if (phase !== 'polling') return;

    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(secs);
    }, 1000);

    pollRef.current = setInterval(async () => {
      const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
      if (secs >= timeout) {
        if (pollRef.current) clearInterval(pollRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        setPhase('timeout');
        setTimeout(onComplete, 1500);
        return;
      }

      try {
        const result = await repository.getSpendRequest(id, { include });
        if (!result) return;

        setRequest(result);

        if (result.status === 'approved') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          setPhase('success');
          setTimeout(onComplete, 1500);
        } else if (result.status === 'denied') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          setPhase('declined');
          setTimeout(onComplete, 1500);
        }
      } catch {
        // Ignore transient poll errors, keep polling
      }
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, repository, id, include, timeout, onComplete]);

  if (phase === 'fetching') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Retrieving spend request {id}...
        </Text>
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ {error}</Text>
      </Box>
    );
  }

  if (phase === 'timeout') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          ✗ Timed out waiting for approval after {timeout}s
        </Text>
        {request && (
          <Box flexDirection="column" marginTop={1} paddingX={2}>
            <Text>
              ID: <Text bold>{request.id}</Text>
            </Text>
            <Text>
              Status: <Text bold>{request.status}</Text>
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (phase === 'polling') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">
            <Spinner type="dots" /> Awaiting approval... ({elapsed}s elapsed)
          </Text>
        </Box>
        {request?.approval_url && (
          <Box marginTop={1} paddingX={2}>
            <Text dimColor>
              Approval URL: <Text color="cyan">{request.approval_url}</Text>
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  if (phase === 'declined') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Spend request declined</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            ID: <Text bold>{request?.id}</Text>
          </Text>
          <Text>
            Status:{' '}
            <Text bold color="red">
              {request?.status}
            </Text>
          </Text>
          <Text>
            Amount:{' '}
            <Text bold>
              {(() => {
                const t = request?.totals.find((t) => t.type === 'total');
                return t ? String(t.amount) : 'N/A';
              })()}
            </Text>
          </Text>
          <Text>
            Merchant: <Text bold>{request?.merchant_name}</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Spend request approved</Text>
      <Box flexDirection="column" marginTop={1} paddingX={2}>
        <Text>
          ID: <Text bold>{request?.id}</Text>
        </Text>
        <Text>
          Status:{' '}
          <Text bold color="green">
            {request?.status}
          </Text>
        </Text>
        <Text>
          Amount:{' '}
          <Text bold>
            {(() => {
              const t = request?.totals.find((t) => t.type === 'total');
              return t ? String(t.amount) : 'N/A';
            })()}
          </Text>
        </Text>
        <Text>
          Merchant: <Text bold>{request?.merchant_name}</Text>
        </Text>
        <Text>
          Line Items:{' '}
          <Text bold>
            {request?.line_items.map((li) => li.name).join(', ')}
          </Text>
        </Text>
        {request?.shared_payment_token && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              {
                '\u001b]8;;https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens\u0007'
              }
              Shared Payment Token{'\u001b]8;;\u0007'}:
            </Text>
            <Text>
              {' '}
              Token: <Text bold>{request.shared_payment_token.id}</Text>
            </Text>
          </Box>
        )}
        {request?.card && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Card Details:</Text>
            <Text>
              {' '}
              Number: <Text bold>{request?.card.number}</Text>
            </Text>
            <Text>
              {' '}
              Brand: <Text bold>{request?.card.brand}</Text>
            </Text>
            <Text>
              {' '}
              Expiry:{' '}
              <Text bold>
                {String(request?.card.exp_month).padStart(2, '0')}/
                {request?.card.exp_year}
              </Text>
            </Text>
            {request?.card.cvc && (
              <Text>
                {' '}
                CVC: <Text bold>{request.card.cvc}</Text>
              </Text>
            )}
            {request?.card.valid_until && (
              <Text>
                {' '}
                Valid Until:{' '}
                <Text bold>
                  {request.card.valid_until}
                </Text>
              </Text>
            )}
            {request?.card.billing_address && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold> Billing Address:</Text>
                <Text>
                  {'  '}
                  {request.card.billing_address.name}
                </Text>
                <Text>
                  {'  '}
                  {request.card.billing_address.line1}
                </Text>
                {request.card.billing_address.line2 && (
                  <Text>
                    {'  '}
                    {request.card.billing_address.line2}
                  </Text>
                )}
                <Text>
                  {'  '}
                  {[
                    request.card.billing_address.city,
                    request.card.billing_address.state,
                    request.card.billing_address.postal_code,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
                <Text>
                  {'  '}
                  {request.card.billing_address.country}
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
