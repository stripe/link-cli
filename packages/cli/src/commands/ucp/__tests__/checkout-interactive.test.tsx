import type {
  IUcpResource,
  UcpCheckout,
  UcpCheckoutWithSpendRequest,
} from '@stripe/link-sdk';
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
const composite: UcpCheckoutWithSpendRequest = {
  ...checkout,
  status: 'completed',
  spend_request: {
    id: 'lsrq_1',
    status: 'requires_action',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:01Z',
    status_details: {
      requires_action: {
        next_action: {
          type: 'partner_auth_challenge',
          resolution: 'auto_resume',
          display_message: 'Confirm in your bank app',
          action_url: 'https://example.com/verify',
        },
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

  it('shows payment action details even when the checkout is completed', async () => {
    const retrieveCheckout = vi.fn().mockResolvedValue(composite);
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(retrieveCheckout)}
        id="checkout_1"
        business="np_1"
        spendRequestId="lsrq_1"
        poll={false}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      const frame = lastFrame();
      for (const value of [
        'Checkout retrieved',
        'completed',
        'lsrq_1',
        'requires_action',
        'partner_auth_challenge',
        'auto_resume',
        'Confirm in your bank app',
        'https://example.com/verify',
      ])
        expect(frame).toContain(value);
    });
    expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('checkout_1', {
      business: 'np_1',
      spend_request_id: 'lsrq_1',
    });
  });

  it('shows pending payment until both checkout and spend request succeed', async () => {
    let resolveFinal:
      | ((value: UcpCheckoutWithSpendRequest) => void)
      | undefined;
    const final = new Promise<UcpCheckoutWithSpendRequest>((resolve) => {
      resolveFinal = resolve;
    });
    const retrieveCheckout = vi
      .fn()
      .mockResolvedValueOnce({
        ...composite,
        spend_request: { ...composite.spend_request, status: 'approved' },
      })
      .mockImplementationOnce(() => final);
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(retrieveCheckout)}
        id="checkout_1"
        business="np_1"
        spendRequestId="lsrq_1"
        poll
        pollInterval={0.001}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Waiting for checkout payment');
      expect(lastFrame()).toContain('approved');
      expect(lastFrame()).not.toContain('payment succeeded');
    });
    if (!resolveFinal) throw new Error('Missing final payment resolver');
    resolveFinal({
      ...composite,
      spend_request: { ...composite.spend_request, status: 'succeeded' },
    });
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('Checkout payment succeeded'),
    );
    expect(retrieveCheckout).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['requires_action', 'Payment action required'],
    ['failed', 'Checkout payment failed'],
  ] as const)('stops polling at %s', async (status, label) => {
    const retrieveCheckout = vi.fn().mockResolvedValue({
      ...composite,
      spend_request: { ...composite.spend_request, status },
    });
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(retrieveCheckout)}
        id="checkout_1"
        business="np_1"
        spendRequestId="lsrq_1"
        poll
        pollInterval={0}
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain(label));
    expect(lastFrame()).not.toContain('payment succeeded');
    expect(retrieveCheckout).toHaveBeenCalledOnce();
  });

  it('shows a timeout without reporting payment success or failure', async () => {
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(
          vi.fn().mockResolvedValue({
            ...composite,
            spend_request: { ...composite.spend_request, status: 'approved' },
          }),
        )}
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
