import type { IUcpResource, UcpCheckout } from '@stripe/link-sdk';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutComplete } from '../checkout-complete';

const errorMessage = {
  type: 'error',
  code: 'missing_shipping_option',
  content: 'Select a shipping option',
  severity: 'recoverable',
  path: '$.fulfillment',
};
function setup(
  submitted: UcpCheckout,
  retrieved: UcpCheckout = { id: 'checkout_1', status: 'completed' },
) {
  const completeCheckout = vi.fn().mockResolvedValue(submitted);
  const retrieveCheckout = vi.fn().mockResolvedValue({
    ...retrieved,
    spend_request: { id: 'lsrq_1', status: 'succeeded' },
  });
  const repository: IUcpResource = {
    completeCheckout,
    retrieveCheckout,
    createCheckout: vi.fn(),
    updateCheckout: vi.fn(),
    cancelCheckout: vi.fn(),
    searchCatalog: vi.fn(),
  };
  const onComplete = vi.fn();
  const view = render(
    <CheckoutComplete
      repository={repository}
      id="checkout_1"
      params={{ business: 'np_1', spend_request_id: 'lsrq_1' }}
      onComplete={onComplete}
      pollInterval={0.001}
    />,
  );
  return { ...view, completeCheckout, retrieveCheckout, onComplete };
}
afterEach(cleanup);

describe('checkout completion errors', () => {
  it('preserves errors from the initial response, skips polling and exits unsuccessfully', async () => {
    const submitted: UcpCheckout = {
      id: 'checkout_1',
      status: 'incomplete',
      messages: [errorMessage],
    };
    const { lastFrame, retrieveCheckout, completeCheckout, onComplete } =
      setup(submitted);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Checkout could not be completed');
      expect(lastFrame()).toContain('Select a shipping option');
      expect(lastFrame()).not.toContain('Verifying');
    });
    expect(completeCheckout).toHaveBeenCalledOnce();
    expect(retrieveCheckout).not.toHaveBeenCalled();
    await vi.waitFor(
      () =>
        expect(onComplete).toHaveBeenCalledExactlyOnceWith(
          submitted,
          'terminal_failure',
        ),
      { timeout: 2500 },
    );
  });

  it.each(['incomplete', 'ready_for_complete', 'canceled'] as const)(
    'stops when completion returns %s without messages',
    async (status) => {
      const { lastFrame, retrieveCheckout } = setup({
        id: 'checkout_1',
        status,
      });
      await vi.waitFor(() =>
        expect(lastFrame()).toContain('Checkout could not be completed'),
      );
      expect(retrieveCheckout).not.toHaveBeenCalled();
    },
  );

  it('stops on checkout errors that appear during polling', async () => {
    const { lastFrame, retrieveCheckout, completeCheckout } = setup(
      { id: 'checkout_1', status: 'complete_in_progress' },
      {
        id: 'checkout_1',
        status: 'complete_in_progress',
        messages: [errorMessage],
      },
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Checkout could not be completed');
      expect(lastFrame()).toContain('Select a shipping option');
    });
    expect(retrieveCheckout).toHaveBeenCalledOnce();
    expect(completeCheckout).toHaveBeenCalledOnce();
  });

  it('shows checkout escalation details without starting payment polling', async () => {
    const { lastFrame, retrieveCheckout } = setup({
      id: 'checkout_1',
      status: 'requires_escalation',
      messages: [{ type: 'error', content: 'Confirm your address' }],
      continue_url: 'https://example.com/review',
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Checkout action required');
      expect(lastFrame()).toContain('Confirm your address');
      expect(lastFrame()).toContain('https://example.com/review');
    });
    expect(retrieveCheckout).not.toHaveBeenCalled();
  });

  it('allows warnings and informational messages while verifying successful completion', async () => {
    const submitted: UcpCheckout = {
      id: 'checkout_1',
      status: 'complete_in_progress',
      messages: [
        { type: 'warning', content: 'Delivery date updated' },
        { type: 'info', content: 'Order received' },
      ],
    };
    const { lastFrame, retrieveCheckout, completeCheckout } = setup(submitted, {
      ...submitted,
      status: 'completed',
    });
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Checkout completed');
      expect(lastFrame()).toContain('Delivery date updated');
      expect(lastFrame()).toContain('Order received');
    });
    expect(retrieveCheckout).toHaveBeenCalledOnce();
    expect(completeCheckout).toHaveBeenCalledOnce();
  });
});
