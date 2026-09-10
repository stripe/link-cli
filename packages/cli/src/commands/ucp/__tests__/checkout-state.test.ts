import type {
  IUcpResource,
  NextActionResolution,
  SpendRequest,
  UcpCheckoutWithSpendRequest,
} from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UCP_POLL_TIMEOUT_SECONDS,
  type UcpCheckoutWaitResult,
  classifyUcpCheckout,
  pollUcpCheckout,
  runUcpCheckoutRetrieve,
  timedOutUcpCheckout,
} from '../checkout-state';
import { checkoutRetrieveOptions } from '../schema';

async function collect(
  generator: AsyncGenerator<UcpCheckoutWaitResult>,
): Promise<UcpCheckoutWaitResult[]> {
  const results: UcpCheckoutWaitResult[] = [];
  for await (const result of generator) results.push(result);
  return results;
}

function resource(
  retrieveCheckout: IUcpResource['retrieveCheckout'],
): IUcpResource {
  return {
    searchCatalog: vi.fn(),
    createCheckout: vi.fn(),
    completeCheckout: vi.fn(),
    retrieveCheckout,
  };
}

function composite(
  checkoutStatus: UcpCheckoutWithSpendRequest['status'],
  spendStatus: SpendRequest['status'],
  resolution?: NextActionResolution,
): UcpCheckoutWithSpendRequest {
  return {
    id: 'dcs_1',
    status: checkoutStatus,
    spend_request: {
      id: 'lsrq_1',
      status: spendStatus,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
      ...(spendStatus === 'requires_action'
        ? {
            status_details: {
              requires_action: {
                next_action: {
                  type: 'three_d_secure',
                  resolution: resolution ?? 'auto_resume',
                  display_message: 'Complete verification',
                  action_url: 'https://example.com/action',
                },
              },
            },
          }
        : {}),
    },
  };
}

describe('classifyUcpCheckout', () => {
  it('requires both success predicates', () => {
    expect(
      classifyUcpCheckout(composite('completed', 'approved')).outcome,
    ).toBe('pending');
    expect(classifyUcpCheckout(composite('open', 'succeeded')).outcome).toBe(
      'pending',
    );
    expect(
      classifyUcpCheckout(composite('completed', 'succeeded')),
    ).toMatchObject({
      outcome: 'success',
      reason: 'checkout_completed_and_spend_request_succeeded',
    });
  });

  it.each(['created', 'pending_approval', 'approved'] as const)(
    'keeps authoritative nonterminal status %s pending',
    (status) => {
      expect(classifyUcpCheckout(composite('open', status)).outcome).toBe(
        'pending',
      );
    },
  );

  it.each([
    ['expired', 'spend_request_expired'],
    ['denied', 'spend_request_denied'],
    ['failed', 'spend_request_failed'],
    ['canceled', 'spend_request_canceled'],
  ] as const)('classifies spend-request %s as %s', (status, reason) => {
    expect(classifyUcpCheckout(composite('open', status))).toMatchObject({
      outcome: 'terminal_failure',
      reason,
    });
  });

  it('classifies checkout expiry before the embedded state', () => {
    expect(
      classifyUcpCheckout(composite('expired', 'succeeded')),
    ).toMatchObject({
      outcome: 'terminal_failure',
      reason: 'checkout_expired',
    });
  });

  it('continues auto-resume while preserving the action', () => {
    expect(
      classifyUcpCheckout(
        composite('requires_action', 'requires_action', 'auto_resume'),
      ),
    ).toMatchObject({
      outcome: 'pending',
      spend_request: {
        status_details: {
          requires_action: {
            next_action: {
              type: 'three_d_secure',
              display_message: 'Complete verification',
              action_url: 'https://example.com/action',
              resolution: 'auto_resume',
            },
          },
        },
      },
    });
  });

  it.each([
    'create_new_spend_request',
    'create_new_spend_request_after_completion',
  ] as const)('stops for action resolution %s', (resolution) => {
    expect(
      classifyUcpCheckout(
        composite('requires_action', 'requires_action', resolution),
      ),
    ).toMatchObject({
      outcome: 'action_required',
      resolution,
      next_action: { display_message: 'Complete verification' },
    });
  });

  it('includes the latest state in timeouts', () => {
    expect(timedOutUcpCheckout(composite('open', 'approved'))).toMatchObject({
      outcome: 'timed_out',
      checkout: { id: 'dcs_1' },
      spend_request: { id: 'lsrq_1' },
    });
    expect(timedOutUcpCheckout()).toMatchObject({
      checkout: null,
      spend_request: null,
    });
  });
});

describe('pollUcpCheckout', () => {
  it('waits through asymmetric success states and deduplicates unchanged output', async () => {
    const states = [
      composite('completed', 'approved'),
      composite('completed', 'approved'),
      composite('completed', 'succeeded'),
    ];
    const repository = resource(
      vi.fn(async () => {
        const state = states.shift();
        if (!state) throw new Error('No checkout state remaining');
        return state;
      }),
    );

    const results = await collect(
      pollUcpCheckout(repository, 'dcs_1', {
        spendRequestId: 'lsrq_1',
        interval: 0.001,
        timeout: 60,
      }),
    );

    expect(repository.retrieveCheckout).toHaveBeenCalledTimes(3);
    expect(results.map(({ outcome }) => outcome)).toEqual([
      'pending',
      'success',
    ]);
    expect(repository.completeCheckout).not.toHaveBeenCalled();
  });

  it('keeps polling when the spend request succeeds before checkout completion', async () => {
    const states = [
      composite('open', 'succeeded'),
      composite('completed', 'succeeded'),
    ];
    const repository = resource(
      vi.fn(async () => {
        const state = states.shift();
        if (!state) throw new Error('No checkout state remaining');
        return state;
      }),
    );

    const results = await collect(
      pollUcpCheckout(repository, 'dcs_1', {
        spendRequestId: 'lsrq_1',
        interval: 0.001,
        timeout: 60,
      }),
    );

    expect(repository.retrieveCheckout).toHaveBeenCalledTimes(2);
    expect(results.map(({ outcome }) => outcome)).toEqual([
      'pending',
      'success',
    ]);
  });

  it('continues after auto-resume but stops on create-new action', async () => {
    const autoStates = [
      composite('requires_action', 'requires_action', 'auto_resume'),
      composite('completed', 'succeeded'),
    ];
    const autoRepository = resource(
      vi.fn(async () => {
        const state = autoStates.shift();
        if (!state) throw new Error('No checkout state remaining');
        return state;
      }),
    );
    const autoResults = await collect(
      pollUcpCheckout(autoRepository, 'dcs_1', {
        spendRequestId: 'lsrq_1',
        interval: 0.001,
        timeout: 60,
      }),
    );
    expect(autoResults.map(({ outcome }) => outcome)).toEqual([
      'pending',
      'success',
    ]);

    const actionRepository = resource(
      vi.fn(async () =>
        composite(
          'requires_action',
          'requires_action',
          'create_new_spend_request',
        ),
      ),
    );
    const actionResults = await collect(
      pollUcpCheckout(actionRepository, 'dcs_1', {
        spendRequestId: 'lsrq_1',
        interval: 0.001,
        timeout: 60,
      }),
    );
    expect(actionResults).toHaveLength(1);
    expect(actionResults[0]).toMatchObject({ outcome: 'action_required' });
  });

  it('propagates retrieval errors immediately', async () => {
    const repository = resource(
      vi.fn(async () => {
        throw new Error('association mismatch');
      }),
    );

    await expect(
      collect(
        pollUcpCheckout(repository, 'dcs_1', {
          spendRequestId: 'lsrq_1',
          interval: 0.001,
          timeout: 60,
        }),
      ),
    ).rejects.toThrow('association mismatch');
    expect(repository.retrieveCheckout).toHaveBeenCalledOnce();
  });

  it('returns timeout with the latest composite state', async () => {
    const repository = resource(
      vi.fn(async () => composite('open', 'approved')),
    );
    const results = await collect(
      pollUcpCheckout(repository, 'dcs_1', {
        spendRequestId: 'lsrq_1',
        interval: 0.001,
        timeout: 0.003,
      }),
    );

    expect(results.at(-1)).toMatchObject({
      outcome: 'timed_out',
      reason: 'timeout',
      checkout: { id: 'dcs_1' },
      spend_request: { id: 'lsrq_1' },
    });
  });
});

describe('consolidated checkout retrieve mode', () => {
  it('retrieves exactly once and returns the raw composite without --poll', async () => {
    const value = composite('open', 'approved');
    const repository = resource(vi.fn(async () => value));

    const result = runUcpCheckoutRetrieve(repository, 'dcs_1', {
      spendRequestId: 'lsrq_1',
      poll: false,
    });

    expect(Symbol.asyncIterator in result).toBe(false);
    await expect(result).resolves.toBe(value);
    expect(repository.retrieveCheckout).toHaveBeenCalledOnce();
  });

  it('returns a polling stream with --poll', async () => {
    const repository = resource(
      vi.fn(async () => composite('completed', 'succeeded')),
    );
    const result = runUcpCheckoutRetrieve(repository, 'dcs_1', {
      spendRequestId: 'lsrq_1',
      poll: true,
      timeout: 60,
    });

    expect(Symbol.asyncIterator in result).toBe(true);
    await expect(
      collect(result as AsyncGenerator<UcpCheckoutWaitResult>),
    ).resolves.toMatchObject([{ outcome: 'success' }]);
  });

  it('defaults polling to 600 seconds and rejects timeout without poll', () => {
    expect(DEFAULT_UCP_POLL_TIMEOUT_SECONDS).toBe(600);
    expect(
      checkoutRetrieveOptions.safeParse({
        spendRequestId: 'lsrq_1',
        poll: false,
        timeout: 10,
      }).success,
    ).toBe(false);
    expect(
      checkoutRetrieveOptions.safeParse({
        spendRequestId: 'lsrq_1',
        poll: true,
        timeout: 10,
      }).success,
    ).toBe(true);
  });
});
