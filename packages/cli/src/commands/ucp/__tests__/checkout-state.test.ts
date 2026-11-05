import type {
  ISpendRequestResource,
  IUcpResource,
  SpendRequest,
  UcpCheckout,
} from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyUcpCheckout,
  DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  pollUcpCheckout,
  timedOutUcpCheckout,
  type UcpCheckoutWaitResult,
} from '../checkout-state';
import { checkoutRetrieveOptions } from '../schema';

const checkout: UcpCheckout = { id: 'dcs_1', status: 'completed' };
function payment(status: SpendRequest['status']): SpendRequest {
  return {
    id: 'lsrq_1',
    status,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    card: {
      number: 'sensitive-card',
      cvc: 'secret-cvc',
    } as SpendRequest['card'],
    shared_payment_token: { id: 'sensitive-token' },
    status_details: {
      requires_action: {
        next_action: {
          type: 'three_d_secure',
          resolution: 'auto_resume',
          display_message: 'Private payment action',
          action_url: 'https://example.com/private-action',
        },
      },
    },
  };
}
function resources(states: [UcpCheckout['status'], SpendRequest['status']][]) {
  const queue = [...states];
  let current: [UcpCheckout['status'], SpendRequest['status']] = queue[0] ?? [
    'completed',
    'succeeded',
  ];
  const repository = {
    retrieveCheckout: vi.fn(async () => {
      current = queue.shift() ?? current;
      return { ...checkout, status: current[0] };
    }),
    completeCheckout: vi.fn(),
  } as unknown as IUcpResource;
  const spendRequests = { retrieve: vi.fn(async () => payment(current[1])) };
  return { repository, spendRequests };
}
async function collect(generator: AsyncGenerator<UcpCheckoutWaitResult>) {
  const results: UcpCheckoutWaitResult[] = [];
  for await (const result of generator) results.push(result);
  return results;
}
function poll(
  repository: IUcpResource,
  spendRequests: Pick<ISpendRequestResource, 'retrieve'>,
  timeout = 60,
) {
  return collect(
    pollUcpCheckout(repository, 'dcs_1', {
      business: 'np_1',
      spendRequestId: 'lsrq_1',
      spendRequests,
      interval: 0.001,
      timeout,
    }),
  );
}

describe('classifyUcpCheckout', () => {
  it('requires both checkout completion and payment success', () => {
    expect(classifyUcpCheckout(checkout, 'approved').outcome).toBe('pending');
    expect(
      classifyUcpCheckout(
        { ...checkout, status: 'complete_in_progress' },
        'succeeded',
      ).outcome,
    ).toBe('pending');
    expect(classifyUcpCheckout(checkout, 'succeeded')).toEqual({
      outcome: 'success',
      reason: 'payment_succeeded',
      checkout,
    });
  });
  it.each(['created', 'pending_approval', 'approved'] as const)(
    'keeps payment %s pending',
    (status) => {
      expect(classifyUcpCheckout(checkout, status).outcome).toBe('pending');
    },
  );
  it.each(['expired', 'denied', 'failed', 'canceled'] as const)(
    'returns a generic failure for payment %s',
    (status) => {
      expect(classifyUcpCheckout(checkout, status)).toEqual({
        outcome: 'terminal_failure',
        reason: 'payment_failed',
        checkout,
      });
    },
  );
  it('prioritizes checkout cancellation', () => {
    const canceled = { ...checkout, status: 'canceled' as const };
    expect(classifyUcpCheckout(canceled, 'succeeded')).toEqual({
      outcome: 'terminal_failure',
      reason: 'checkout_canceled',
      checkout: canceled,
    });
  });
  it.each(['complete_in_progress', 'completed'] as const)(
    'stops at payment action even when checkout is %s',
    (status) => {
      const current = { ...checkout, status };
      expect(classifyUcpCheckout(current, 'requires_action')).toEqual({
        outcome: 'action_required',
        reason: 'payment_action_required',
        checkout: current,
      });
    },
  );
  it('includes only the latest checkout in timeouts', () => {
    expect(timedOutUcpCheckout(checkout)).toEqual({
      outcome: 'timed_out',
      reason: 'timeout',
      checkout,
    });
    expect(timedOutUcpCheckout()).toEqual({
      outcome: 'timed_out',
      reason: 'timeout',
      checkout: null,
    });
  });
});

describe('pollUcpCheckout', () => {
  it('retrieves checkout and payment separately, deduplicates updates, and returns no payment details', async () => {
    const { repository, spendRequests } = resources([
      ['completed', 'approved'],
      ['completed', 'approved'],
      ['completed', 'succeeded'],
    ]);
    const results = await poll(repository, spendRequests);
    expect(results.map(({ outcome }) => outcome)).toEqual([
      'pending',
      'success',
    ]);
    expect(repository.retrieveCheckout).toHaveBeenCalledTimes(3);
    expect(repository.retrieveCheckout).toHaveBeenCalledWith('dcs_1', {
      business: 'np_1',
    });
    expect(spendRequests.retrieve).toHaveBeenCalledTimes(3);
    expect(spendRequests.retrieve).toHaveBeenCalledWith('lsrq_1');
    expect(repository.completeCheckout).not.toHaveBeenCalled();
    expect(JSON.stringify(results)).not.toMatch(
      /spend_request|lsrq_1|sensitive|private-action|Private payment/,
    );
  });
  it('keeps polling if payment succeeds before checkout completion', async () => {
    const { repository, spendRequests } = resources([
      ['complete_in_progress', 'succeeded'],
      ['completed', 'succeeded'],
    ]);
    const results = await poll(repository, spendRequests);
    expect(results.map(({ outcome }) => outcome)).toEqual([
      'pending',
      'success',
    ]);
  });
  it('stops at required actions without returning action or credential fields', async () => {
    const { repository, spendRequests } = resources([
      ['completed', 'requires_action'],
    ]);
    expect(await poll(repository, spendRequests)).toEqual([
      {
        outcome: 'action_required',
        reason: 'payment_action_required',
        checkout,
      },
    ]);
    expect(spendRequests.retrieve).toHaveBeenCalledOnce();
  });
  it('propagates checkout retrieval errors immediately', async () => {
    const { repository, spendRequests } = resources([
      ['completed', 'approved'],
    ]);
    vi.mocked(repository.retrieveCheckout).mockRejectedValue(
      new Error('checkout unavailable'),
    );
    await expect(poll(repository, spendRequests)).rejects.toThrow(
      'checkout unavailable',
    );
    expect(spendRequests.retrieve).not.toHaveBeenCalled();
  });
  it('propagates payment retrieval errors', async () => {
    const { repository, spendRequests } = resources([
      ['completed', 'approved'],
    ]);
    spendRequests.retrieve.mockRejectedValue(new Error('payment unavailable'));
    await expect(poll(repository, spendRequests)).rejects.toThrow(
      'payment unavailable',
    );
  });
  it('fails to verify a missing payment without claiming success', async () => {
    const { repository } = resources([['completed', 'succeeded']]);
    await expect(
      poll(repository, { retrieve: vi.fn(async () => null) }),
    ).rejects.toThrow('Unable to verify checkout payment');
  });
  it('returns a timeout with checkout only', async () => {
    const { repository, spendRequests } = resources([
      ['completed', 'approved'],
    ]);
    expect(await poll(repository, spendRequests, 0)).toEqual([
      { outcome: 'timed_out', reason: 'timeout', checkout },
    ]);
  });
  it('defaults polling to 600 seconds and requires a spend request ID only for polling', () => {
    expect(DEFAULT_UCP_POLL_TIMEOUT_SECONDS).toBe(600);
    expect(
      checkoutRetrieveOptions.safeParse({ business: 'np_1' }).success,
    ).toBe(true);
    expect(
      checkoutRetrieveOptions.safeParse({ business: 'np_1', poll: true })
        .success,
    ).toBe(false);
    expect(
      checkoutRetrieveOptions.safeParse({
        business: 'np_1',
        spendRequestId: 'lsrq_1',
        timeout: 10,
      }).success,
    ).toBe(false);
    expect(
      checkoutRetrieveOptions.safeParse({
        business: 'np_1',
        spendRequestId: 'lsrq_1',
        poll: true,
        timeout: 10,
      }).success,
    ).toBe(true);
  });
});
