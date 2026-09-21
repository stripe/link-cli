import type {
  CompleteUcpCheckoutParams,
  IUcpResource,
  NextAction,
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
  type UcpCheckoutWaitReason,
} from './checkout-state';
import { CheckoutSummary } from './checkout-summary';

interface CheckoutCompleteProps {
  repository: IUcpResource;
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
  | 'awaiting_action'
  | 'action_required'
  | 'success'
  | 'terminal_failure'
  | 'timed_out'
  | 'error';

export const CheckoutComplete: React.FC<CheckoutCompleteProps> = ({
  repository,
  id,
  params,
  onComplete,
  pollInterval = UCP_POLL_INTERVAL_SECONDS,
  pollTimeout = DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
}) => {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('completing');
  const [checkout, setCheckout] = useState<UcpCheckout | null>(null);
  const [nextAction, setNextAction] = useState<NextAction | undefined>();
  const [failureReason, setFailureReason] = useState<UcpCheckoutWaitReason>();
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
          test: params.test,
          interval: pollInterval,
          timeout: pollTimeout,
          continueAutoResume: true,
        })) {
          if (cancelled) return;

          setCheckout(state.checkout);
          setNextAction(state.next_action);
          setFailureReason(state.reason);

          if (state.outcome === 'pending') {
            setPhase('polling');
          } else if (state.outcome === 'action_required') {
            if (state.resolution === 'auto_resume' && state.next_action) {
              setPhase('awaiting_action');
            } else {
              setPhase('action_required');
              finish(state.checkout);
            }
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
  }, [repository, id, params, pollInterval, pollTimeout, wrappedOnComplete]);

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

  if (phase === 'awaiting_action') {
    return (
      <Box flexDirection="column">
        <Text color="cyan">
          <Spinner type="dots" /> Waiting for 3D Secure verification to
          complete...
        </Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text>{nextAction?.display_message}</Text>
          {nextAction?.action_url && (
            <Text>
              URL: <Text color="cyan">{nextAction.action_url}</Text>
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  if (phase === 'action_required') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⚠ Payment action required</Text>
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          {nextAction ? (
            <>
              <Text>
                Type: <Text bold>{nextAction.type}</Text>
              </Text>
              <Text>{nextAction.display_message}</Text>
              {nextAction.action_url && (
                <Text>
                  URL: <Text color="cyan">{nextAction.action_url}</Text>
                </Text>
              )}
              <Text dimColor>
                Complete the action, then create a new spend request.
              </Text>
            </>
          ) : (
            <Text color="red">
              The spend request requires action but no action details were
              returned.
            </Text>
          )}
        </Box>
      </Box>
    );
  }

  if (phase === 'terminal_failure') {
    return (
      <Box flexDirection="column">
        <Text color="red">✗ Checkout payment failed</Text>
        <Text color="red">Reason: {failureReason}</Text>
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
          Run `ucp checkout retrieve {id} --spend-request-id{' '}
          {params.spend_request_id} --poll` to check the current status.
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
