import { defaultShippingAddress, sameAddress } from '../link.ts';
import type { Observed } from '../seller.ts';
import type { Validation } from './index.ts';

function nextSteps(observed: Observed) {
  if (observed.payment) {
    return 'The payment succeeded but the purchase was never confirmed. This could be caused by the confirmation token not being sent to the confirmation endpoint.';
  }
  if (observed.error) {
    return `There was an error: ${observed.error}`;
  }
  if (observed.api_viewed) {
    return 'The API was viewed but the transaction was never completed. This could be caused by a spend request that was never approved or a timeout.';
  }
  return 'The seller received no requests. This could be caused by the task not reaching the agent or the seller URL being unreachable from where it runs.';
}

export const sptPurchase: Validation = {
  id: 'spt-purchase',
  product: { name: 'Printed trail map', amount: 100, ships: true },
  task: (url) =>
    `Buy the printed trail map from ${url}, ship it to my default address, and confirm your purchase.`,
  async evaluate({ observed, link }) {
    if (observed.terminal_error) {
      return {
        status: 'failed',
        error: observed.terminal_error,
        next_steps:
          'The payment was rejected, so this run cannot pass. This could be caused by an SPT for a different network ID or amount.',
      };
    }
    if (!observed.confirmed) {
      return {
        status: 'pending',
        error: observed.error,
        next_steps: nextSteps(observed),
      };
    }
    const shipping = await defaultShippingAddress(link);
    if ('skipped' in shipping) {
      return {
        status: 'passed',
        ...observed.payment,
        shipping: 'skipped',
        shipping_note: shipping.skipped,
      };
    }
    if (
      observed.shipping_address &&
      sameAddress(shipping.address, observed.shipping_address)
    ) {
      return { status: 'passed', ...observed.payment, shipping: 'passed' };
    }
    return {
      status: 'failed',
      ...observed.payment,
      shipping: 'failed',
      error:
        'The order shipped to an address other than the default Link shipping address.',
    };
  },
};
