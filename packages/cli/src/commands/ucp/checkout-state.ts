import type {
  ISpendRequestResource,
  IUcpResource,
  SpendRequest,
  UcpCheckout,
} from '@stripe/link-sdk';
import { pollUntil } from '../../utils/poll-until';

export type UcpCheckoutWaitReason =
  | 'payment_succeeded'
  | 'payment_action_required'
  | 'checkout_canceled'
  | 'payment_failed'
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
}

/** Payment state is used for classification only and never attached to output. */
export function classifyUcpCheckout(
  checkout: UcpCheckout,
  paymentStatus: SpendRequest['status'],
): UcpCheckoutWaitResult {
  if (checkout.status === 'canceled') {
    return {
      outcome: 'terminal_failure',
      reason: 'checkout_canceled',
      checkout,
    };
  }

  if (['expired', 'denied', 'failed', 'canceled'].includes(paymentStatus)) {
    return { outcome: 'terminal_failure', reason: 'payment_failed', checkout };
  }

  if (paymentStatus === 'requires_action') {
    return {
      outcome: 'action_required',
      reason: 'payment_action_required',
      checkout,
    };
  }

  if (checkout.status === 'completed' && paymentStatus === 'succeeded') {
    return { outcome: 'success', reason: 'payment_succeeded', checkout };
  }

  return { outcome: 'pending', checkout };
}

export function timedOutUcpCheckout(
  checkout?: UcpCheckout,
): UcpCheckoutWaitResult {
  return {
    outcome: 'timed_out',
    reason: 'timeout',
    checkout: checkout ?? null,
  };
}

export const UCP_POLL_INTERVAL_SECONDS = 2;
export const DEFAULT_UCP_POLL_TIMEOUT_SECONDS = 600;

export interface PollUcpCheckoutOptions {
  business: string;
  spendRequestId: string;
  spendRequests: Pick<ISpendRequestResource, 'retrieve'>;
  /** Internal test override; the CLI always uses UCP_POLL_INTERVAL_SECONDS. */
  interval?: number;
  timeout: number;
}

export async function* pollUcpCheckout(
  repository: IUcpResource,
  id: string,
  options: PollUcpCheckoutOptions,
): AsyncGenerator<UcpCheckoutWaitResult> {
  for await (const result of pollUntil({
    fn: async () => {
      const checkout = await repository.retrieveCheckout(id, {
        business: options.business,
      });
      const spendRequest = await options.spendRequests.retrieve(
        options.spendRequestId,
      );
      if (!spendRequest) throw new Error('Unable to verify checkout payment');
      return classifyUcpCheckout(checkout, spendRequest.status);
    },
    isTerminal: (state) => state.outcome !== 'pending',
    interval: options.interval ?? UCP_POLL_INTERVAL_SECONDS,
    timeout: options.timeout,
    maxAttempts: 0,
  })) {
    if (result.reason) {
      yield timedOutUcpCheckout(result.value.checkout ?? undefined);
      return;
    }

    yield result.value;
    if (result.terminal) return;
  }
}
