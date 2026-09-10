import type {
  IUcpResource,
  NextAction,
  SpendRequest,
  UcpCheckout,
  UcpCheckoutWithSpendRequest,
} from '@stripe/link-sdk';
import { pollUntil } from '../../utils/poll-until';

export type UcpCheckoutWaitReason =
  | 'checkout_completed_and_spend_request_succeeded'
  | 'spend_request_requires_action'
  | 'checkout_expired'
  | 'spend_request_expired'
  | 'spend_request_denied'
  | 'spend_request_failed'
  | 'spend_request_canceled'
  | 'timeout';

export interface UcpCheckoutWaitResult {
  outcome:
    | 'pending'
    | 'success'
    | 'action_required'
    | 'terminal_failure'
    | 'timed_out';
  reason?: UcpCheckoutWaitReason;
  checkout: UcpCheckout | null;
  spend_request: SpendRequest | null;
  resolution?: string;
  next_action?: NextAction;
}

function splitComposite(
  composite?: UcpCheckoutWithSpendRequest,
): Pick<UcpCheckoutWaitResult, 'checkout' | 'spend_request'> {
  if (!composite) return { checkout: null, spend_request: null };
  const { spend_request, ...checkout } = composite;
  return { checkout, spend_request };
}

export function classifyUcpCheckout(
  composite: UcpCheckoutWithSpendRequest,
): UcpCheckoutWaitResult {
  const state = splitComposite(composite);
  const spendRequest = composite.spend_request;

  if (composite.status === 'expired') {
    return {
      outcome: 'terminal_failure',
      reason: 'checkout_expired',
      ...state,
    };
  }

  const spendFailureReasons: Partial<
    Record<SpendRequest['status'], UcpCheckoutWaitReason>
  > = {
    expired: 'spend_request_expired',
    denied: 'spend_request_denied',
    failed: 'spend_request_failed',
    canceled: 'spend_request_canceled',
  };
  const failureReason = spendFailureReasons[spendRequest.status];
  if (failureReason) {
    return { outcome: 'terminal_failure', reason: failureReason, ...state };
  }

  if (spendRequest.status === 'requires_action') {
    const nextAction =
      spendRequest.status_details?.requires_action?.next_action;
    if (nextAction?.resolution !== 'auto_resume') {
      return {
        outcome: 'action_required',
        reason: 'spend_request_requires_action',
        resolution: nextAction?.resolution ?? 'unknown',
        ...(nextAction ? { next_action: nextAction } : {}),
        ...state,
      };
    }
  }

  if (composite.status === 'completed' && spendRequest.status === 'succeeded') {
    return {
      outcome: 'success',
      reason: 'checkout_completed_and_spend_request_succeeded',
      ...state,
    };
  }

  return { outcome: 'pending', ...state };
}

export function timedOutUcpCheckout(
  composite?: UcpCheckoutWithSpendRequest,
): UcpCheckoutWaitResult {
  return {
    outcome: 'timed_out',
    reason: 'timeout',
    ...splitComposite(composite),
  };
}

export const UCP_POLL_INTERVAL_SECONDS = 2;
export const DEFAULT_UCP_POLL_TIMEOUT_SECONDS = 600;

export interface PollUcpCheckoutOptions {
  spendRequestId: string;
  test?: boolean;
  /** Internal test override; the CLI always uses UCP_POLL_INTERVAL_SECONDS. */
  interval?: number;
  timeout: number;
}

export interface RunUcpCheckoutRetrieveOptions
  extends Omit<PollUcpCheckoutOptions, 'timeout'> {
  poll: boolean;
  timeout?: number;
}

export function runUcpCheckoutRetrieve(
  repository: IUcpResource,
  id: string,
  options: RunUcpCheckoutRetrieveOptions,
):
  | Promise<UcpCheckoutWithSpendRequest>
  | AsyncGenerator<UcpCheckoutWaitResult> {
  if (!options.poll) {
    return repository.retrieveCheckout(id, {
      spend_request_id: options.spendRequestId,
      test: options.test,
    });
  }

  return pollUcpCheckout(repository, id, {
    spendRequestId: options.spendRequestId,
    test: options.test,
    timeout: options.timeout ?? DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  });
}

export async function* pollUcpCheckout(
  repository: IUcpResource,
  id: string,
  options: PollUcpCheckoutOptions,
): AsyncGenerator<UcpCheckoutWaitResult> {
  for await (const result of pollUntil({
    fn: () =>
      repository.retrieveCheckout(id, {
        spend_request_id: options.spendRequestId,
        test: options.test,
      }),
    isTerminal: (composite) =>
      classifyUcpCheckout(composite).outcome !== 'pending',
    interval: options.interval ?? UCP_POLL_INTERVAL_SECONDS,
    timeout: options.timeout,
    maxAttempts: 0,
  })) {
    if (result.reason) {
      yield timedOutUcpCheckout(result.value);
      return;
    }

    yield classifyUcpCheckout(result.value);
    if (result.terminal) return;
  }
}
