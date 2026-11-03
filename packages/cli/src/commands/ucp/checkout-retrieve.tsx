import type { IUcpResource, SpendRequest, UcpCheckout } from '@stripe/link-sdk';
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
  poll,
  timeout = DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  onComplete,
  pollInterval,
}: CheckoutRetrieveProps) {
  const { exit } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<UcpCheckout | null>(null);
  const [spendRequest, setSpendRequest] = useState<SpendRequest | null>(null);
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
          for await (const current of pollUcpCheckout(repository, id, {
            business,
            spendRequestId,
            timeout,
            ...(pollInterval !== undefined ? { interval: pollInterval } : {}),
          })) {
            if (cancelled) return;
            setCheckout(current.checkout);
            setSpendRequest(current.spend_request);
            setState(current);
            setLoading(false);
            if (current.outcome !== 'pending') finish(current);
          }
        } else {
          let result: UcpCheckout;
          if (spendRequestId) {
            const composite = await repository.retrieveCheckout(id, {
              business,
              spend_request_id: spendRequestId,
            });
            if (cancelled) return;
            result = composite;
            setSpendRequest(composite.spend_request);
          } else {
            result = await repository.retrieveCheckout(id, { business });
            if (cancelled) return;
          }
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
  const checkoutIssue =
    state?.reason?.startsWith('checkout_') && state.outcome !== 'success';
  const pending = loading || state?.outcome === 'pending';
  const nextAction = spendRequest?.status_details?.requires_action?.next_action;

  return (
    <Box flexDirection="column">
      <Text color={outcome?.color ?? (loading ? 'cyan' : 'green')}>
        {pending && <Spinner type="dots" />}{' '}
        {loading
          ? 'Retrieving checkout...'
          : checkoutIssue
            ? '⚠ Checkout needs attention'
            : (outcome?.text ?? '✓ Checkout retrieved')}
      </Text>
      {checkout && <CheckoutSummary checkout={checkout} />}
      {spendRequest && (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>
            Spend request: <Text bold>{spendRequest.id}</Text>
          </Text>
          <Text>
            Payment status: <Text bold>{spendRequest.status}</Text>
          </Text>
          {spendRequest.status === 'requires_action' && (
            <>
              <Text color="yellow">⚠ Payment action required</Text>
              {nextAction ? (
                <>
                  <Text>Type: {nextAction.type}</Text>
                  <Text>Resolution: {nextAction.resolution}</Text>
                  <Text>{nextAction.display_message}</Text>
                  {nextAction.action_url && (
                    <Text>URL: {nextAction.action_url}</Text>
                  )}
                  <Text dimColor>
                    {nextAction.resolution === 'auto_resume'
                      ? 'Complete this action, then retrieve this checkout with --poll.'
                      : 'Complete this action and follow its recovery instructions.'}
                  </Text>
                </>
              ) : (
                <Text color="red">
                  No payment action details were returned.
                </Text>
              )}
            </>
          )}
        </Box>
      )}
      {state?.reason && state.outcome !== 'pending' && (
        <Text dimColor>Reason: {state.reason}</Text>
      )}
    </Box>
  );
}
