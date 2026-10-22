import { defaultShippingAddress, type LinkCli, sameAddress } from '../link.ts';
import type { Observed } from '../seller.ts';
import type { Verdict } from './index.ts';

export async function evaluateShipping(
  observed: Observed,
  link: LinkCli,
): Promise<Verdict> {
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
}
