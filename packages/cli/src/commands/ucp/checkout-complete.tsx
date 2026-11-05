import type {
  CompleteUcpCheckoutParams,
  ISpendRequestResource,
  IUcpResource,
  UcpCheckout,
} from '@stripe/link-sdk';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DISPLAY_DELAY_MS } from '../../utils/constants';
import {
  DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  pollUcpCheckout,
  UCP_POLL_INTERVAL_SECONDS,
} from './checkout-state';
import { CheckoutSummary } from './checkout-summary';

interface CheckoutCompleteProps {
  repository: IUcpResource;
  spendRequests: Pick<ISpendRequestResource, 'retrieve'>;
  id: string;
  params: CompleteUcpCheckoutParams;
  onComplete: (result: UcpCheckout | null) => void;
  /** Internal test override; interactive CLI polling uses the shared default. */
  pollInterval?: number;
  /** Internal test override; interactive CLI polling uses the shared default. */
  pollTimeout?: number;
}

type Phase =
  | 'completing'
  | 'checking'
  | 'polling'
  | 'action_required'
  | 'success'
  | 'terminal_failure'
  | 'timed_out'
  | 'error';

export const CheckoutComplete: React.FC<CheckoutCompleteProps> = ({
  repository,
  spendRequests,
  id,
  params,
  onComplete,
  pollInterval = UCP_POLL_INTERVAL_SECONDS,
  pollTimeout = DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
}) => {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('completing');
  const [checkout, setCheckout] = useState<UcpCheckout | null>(null);
  const [error, setError] = useState('');
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wrappedOnComplete = useCallback(
    (result: UcpCheckout | null) => {
      onComplete(result);
      exit();
    },
    [onComplete, exit],
  );

  useEffect(() => {
    let cancelled = false;

    const finish = (result: UcpCheckout | null) => {
      completionTimerRef.current = setTimeout(
        () => wrappedOnComplete(result),
        DISPLAY_DELAY_MS,
      );
    };

    const run = async () => {
      try {
        const submitted = await repository.completeCheckout(id, params);
        if (cancelled) return;
        setCheckout(submitted);
        setPhase('checking');

        for await (const state of pollUcpCheckout(repository, id, {
          spendRequestId: params.spend_request_id,
          business: params.business,
          interval: pollInterval,
          timeout: pollTimeout,
          spendRequests,
        })) {
          if (cancelled) return;

          setCheckout(state.checkout);

          if (state.outcome === 'pending') {
            setPhase('polling');
          } else if (state.outcome === 'action_required') {
            setPhase('action_required');
            finish(state.checkout);
          } else if (state.outcome === 'success') {
            setPhase('success');
            finish(state.checkout);
          } else if (state.outcome === 'terminal_failure') {
            setPhase('terminal_failure');
            finish(state.checkout);
          } else {
            setPhase('timed_out');
            finish(state.checkout);
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : JSON.stringify(err));
        setPhase('error');
        finish(null);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, [
    repository,
    spendRequests,
    id,
    params,
    pollInterval,
    pollTimeout,
    wrappedOnComplete,
  ]);

  if (phase === 'completing') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" /> Completing checkout...
        </Text>
      </Box>
    );
  }

  if (phase === 'checking' || phase === 'polling') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">
          <Spinner type="dots" /> Verifying checkout and payment...
        </Text>
        {checkout && <CheckoutSummary checkout={checkout} />}
      </Box>
    );
  }

  if (phase === 'action_required') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⚠ Payment action required</Text>
        <Text dimColor>
          Use spend-request commands to review and resolve the payment action.
        </Text>
        {checkout && <CheckoutSummary checkout={checkout} />}
      </Box>
    );
  }

  if (phase === 'terminal_failure') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Checkout payment failed</Text>
        {checkout && <CheckoutSummary checkout={checkout} />}
      </Box>
    );
  }

  if (phase === 'timed_out') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">
          ✗ Timed out waiting for checkout payment to resolve
        </Text>
        <Text dimColor>
          Run `ucp checkout retrieve {id} --spend-request-id
          &lt;spend_request_id&gt; --business {params.business} --poll` to check
          the current status.
        </Text>
        {checkout && <CheckoutSummary checkout={checkout} />}
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Failed to complete checkout</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ Checkout completed</Text>
      {checkout && <CheckoutSummary checkout={checkout} />}
    </Box>
  );
};
