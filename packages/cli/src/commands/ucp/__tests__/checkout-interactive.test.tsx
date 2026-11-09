import type { IUcpResource, UcpCheckout } from '@stripe/link-sdk';
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

  it('renders retrieval errors', async () => {
    const { lastFrame } = render(
      <CheckoutRetrieve
        repository={repository(
          vi.fn().mockRejectedValue(new Error('Checkout not found')),
        )}
        id="checkout_1"
        business="np_1"
        onComplete={() => {}}
      />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Failed to retrieve checkout');
      expect(lastFrame()).toContain('Checkout not found');
    });
  });
});
