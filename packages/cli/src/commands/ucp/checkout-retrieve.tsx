import type {
  ISpendRequestResource,
  IUcpResource,
  UcpCheckout,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import {
  DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  pollUcpCheckout,
  type UcpCheckoutWaitResult,
} from './checkout-state';
import { CheckoutSummary } from './checkout-summary';

export type CheckoutRetrieveResult = UcpCheckout | UcpCheckoutWaitResult;

interface CheckoutRetrieveProps {
  repository: IUcpResource;
  id: string;
  business: string;
  spendRequestId?: string;
  spendRequests?: Pick<ISpendRequestResource, 'retrieve'>;
  poll: boolean;
  timeout?: number;
  onComplete: (result: CheckoutRetrieveResult | null) => void;
  /** Internal test override; CLI polling uses the shared interval. */
  pollInterval?: number;
}

const outcomes = {
  pending: { color: 'cyan', text: 'Waiting for checkout payment...' },
  success: { color: 'green', text: '✓ Checkout payment succeeded' },
  action_required: { color: 'yellow', text: '⚠ Payment action required' },
  terminal_failure: { color: 'red', text: '✗ Checkout payment failed' },
  timed_out: {
    color: 'yellow',
    text: '⚠ Timed out waiting for checkout payment',
  },
} as const;

export function CheckoutRetrieve({
  repository,
  id,
  business,
  spendRequestId,
  spendRequests,
  poll,
  timeout = DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  onComplete,
  pollInterval,
}: CheckoutRetrieveProps) {
  const { exit } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<UcpCheckout | null>(null);
  const [state, setState] = useState<UcpCheckoutWaitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CheckoutRetrieveResult | null) => {
      timer = setTimeout(() => {
        onComplete(result);
        exit();
      }, DISPLAY_DELAY_MS);
    };

    const run = async () => {
      try {
        if (poll) {
          if (!spendRequestId)
            throw new Error('--poll requires --spend-request-id');
          if (!spendRequests)
            throw new Error('Payment polling resource is required');
          for await (const current of pollUcpCheckout(repository, id, {
            business,
            spendRequestId,
            spendRequests,
            timeout,
            ...(pollInterval !== undefined ? { interval: pollInterval } : {}),
          })) {
            if (cancelled) return;
            setCheckout(current.checkout);
            setState(current);
            setLoading(false);
            if (current.outcome !== 'pending') finish(current);
          }
        } else {
          const result = await repository.retrieveCheckout(id, { business });
          if (cancelled) return;
          setCheckout(result);
          setLoading(false);
          finish(result);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        finish(null);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    repository,
    id,
    business,
    spendRequestId,
    spendRequests,
    poll,
    timeout,
    pollInterval,
    onComplete,
    exit,
  ]);

  if (error !== null) {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to retrieve checkout</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  const outcome = state ? outcomes[state.outcome] : undefined;
  const pending = loading || state?.outcome === 'pending';

  return (
    <Box flexDirection="column">
      <Text color={outcome?.color ?? (loading ? 'cyan' : 'green')}>
        {pending && <Spinner type="dots" />}{' '}
        {loading
          ? 'Retrieving checkout...'
          : (outcome?.text ?? '✓ Checkout retrieved')}
      </Text>
      {checkout && <CheckoutSummary checkout={checkout} />}
      {state?.reason && state.outcome !== 'pending' && (
        <Text dimColor>Reason: {state.reason}</Text>
      )}
    </Box>
  );
}
