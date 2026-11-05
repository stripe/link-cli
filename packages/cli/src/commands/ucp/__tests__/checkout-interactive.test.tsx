import type { IUcpResource, SpendRequest, UcpCheckout } from '@stripe/link-sdk';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeResource } from '../../../utils/resource-factory';
import { CheckoutAction } from '../checkout-action';
import { CheckoutRetrieve } from '../checkout-retrieve';

const checkout: UcpCheckout = {
  id: 'checkout_1',
  status: 'ready_for_complete',
  currency: 'usd',
  totals: [{ type: 'total', amount: 5500 }],
  line_items: [{ item: { id: 'sku_1' }, quantity: 2 }],
};
const spendRequest: SpendRequest = {
  id: 'lsrq_1',
  status: 'requires_action',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
  shared_payment_token: { id: 'sensitive-token' },
  status_details: {
    requires_action: {
      next_action: {
        type: 'partner_auth_challenge',
        resolution: 'auto_resume',
        display_message: 'Private payment action',
        action_url: 'https://example.com/private-action',
      },
    },
  },
};

function repository(
  retrieveCheckout = vi.fn().mockResolvedValue(checkout),
): IUcpResource {
  return sanitizeResource({
    searchCatalog: vi.fn(),
    createCheckout: vi.fn(),
    updateCheckout: vi.fn(),
    completeCheckout: vi.fn(),
    cancelCheckout: vi.fn(),
    retrieveCheckout,
  });
}

afterEach(cleanup);

describe.each(['update', 'cancel'] as const)(
  'checkout %s terminal view',
  (operation) => {
    it('performs the operation once and renders its checkout summary', async () => {
      const result = {
        ...checkout,
        status:
          operation === 'cancel' ? ('canceled' as const) : checkout.status,
      };
      const action = vi.fn().mockResolvedValue(result);
      const { lastFrame } = render(
        <CheckoutAction
          action={action}
          operation={operation}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(
          operation === 'cancel' ? 'Checkout canceled' : 'Checkout updated',
        );
        expect(lastFrame()).toContain('checkout_1');
        expect(lastFrame()).toContain('$55.00');
        expect(lastFrame()).toContain('sku_1 ×2');
      });
      expect(action).toHaveBeenCalledOnce();
    });

    it('renders API errors', async () => {
      const { lastFrame } = render(
        <CheckoutAction
          action={vi
            .fn()
            .mockRejectedValue(new Error('Checkout cannot be changed'))}
          operation={operation}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain(`Failed to ${operation} checkout`);
        expect(lastFrame()).toContain('Checkout cannot be changed');
      });
    });
  },
);

describe('checkout retrieve terminal view', () => {
  it('retrieves once without a spend request and returns the complete result on exit', async () => {
    const retrieveCheckout = vi.fn().mockResolvedValue(checkout);
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(retrieveCheckout)}
        id="checkout_1"
        business="np_1"
        poll={false}
        onComplete={onComplete}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Checkout retrieved');
      expect(lastFrame()).toContain('$55.00');
    });
    expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('checkout_1', {
      business: 'np_1',
    });
    await vi.waitFor(
      () => expect(onComplete).toHaveBeenCalledExactlyOnceWith(checkout),
      { timeout: 2500 },
    );
  });

  it('returns only checkout when a spend request ID is supplied without polling', async () => {
    const retrieveCheckout = vi.fn().mockResolvedValue(checkout);
    const spendRequests = { retrieve: vi.fn() };
    const onComplete = vi.fn();
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(retrieveCheckout)}
        spendRequests={spendRequests}
        id="checkout_1"
        business="np_1"
        spendRequestId="lsrq_1"
        poll={false}
        onComplete={onComplete}
      />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('Checkout retrieved'));
    expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('checkout_1', {
      business: 'np_1',
    });
    expect(spendRequests.retrieve).not.toHaveBeenCalled();
    expect(lastFrame()).not.toContain('lsrq_1');
    await vi.waitFor(
      () => expect(onComplete).toHaveBeenCalledExactlyOnceWith(checkout),
      { timeout: 2500 },
    );
  });

  it('waits for payment success even when checkout is already completed', async () => {
    const completed: UcpCheckout = { ...checkout, status: 'completed' };
    let resolveFinal: ((value: SpendRequest) => void) | undefined;
    const final = new Promise<SpendRequest>((resolve) => {
      resolveFinal = resolve;
    });
    const spendRequests = {
      retrieve: vi
        .fn()
        .mockResolvedValueOnce({ ...spendRequest, status: 'approved' })
        .mockImplementationOnce(() => final),
    };
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(vi.fn().mockResolvedValue(completed))}
        spendRequests={spendRequests}
        id="checkout_1"
        business="np_1"
        spendRequestId="lsrq_1"
        poll
        pollInterval={0.001}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Waiting for checkout payment'),
    );
    expect(lastFrame()).not.toContain('payment succeeded');
    expect(lastFrame()).not.toContain('approved');
    if (!resolveFinal) throw new Error('Missing final payment resolver');
    resolveFinal({ ...spendRequest, status: 'succeeded' });
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Checkout payment succeeded'),
    );
    expect(lastFrame()).not.toMatch(
      /lsrq_1|sensitive-token|Private payment|private-action/,
    );
  });

  it.each([
    ['requires_action', 'Payment action required'],
    ['failed', 'Checkout payment failed'],
  ] as const)(
    'stops at payment %s without displaying its fields',
    async (status, label) => {
      const spendRequests = {
        retrieve: vi.fn(async () => ({ ...spendRequest, status })),
      };
      const { lastFrame } = render(
        <CheckoutRetrieve
          repository={repository()}
          spendRequests={spendRequests}
          id="checkout_1"
          business="np_1"
          spendRequestId="lsrq_1"
          poll
          pollInterval={0}
          onComplete={() => {}}
        />,
      );
      await vi.waitFor(() => expect(lastFrame()).toContain(label));
      expect(lastFrame()).not.toMatch(
        /lsrq_1|sensitive-token|Private payment|private-action|partner_auth_challenge|auto_resume/,
      );
      expect(spendRequests.retrieve).toHaveBeenCalledOnce();
    },
  );

  it('shows a timeout without reporting payment success or failure', async () => {
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository()}
        spendRequests={{
          retrieve: vi.fn(async () => ({
            ...spendRequest,
            status: 'approved' as const,
          })),
        }}
        id="checkout_1"
        business="np_1"
        spendRequestId="lsrq_1"
        poll
        timeout={0}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Timed out waiting for checkout payment'),
    );
    expect(lastFrame()).not.toContain('payment succeeded');
    expect(lastFrame()).not.toContain('payment failed');
  });

  it('renders retrieval errors', async () => {
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(
          vi.fn().mockRejectedValue(new Error('Checkout not found')),
        )}
        id="checkout_1"
        business="np_1"
        poll={false}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Failed to retrieve checkout');
      expect(lastFrame()).toContain('Checkout not found');
    });
  });
});
