import type { UcpCheckout } from '@stripe/link-sdk';
import { z } from 'zod';
import { buildCommandContinuation } from '../../utils/command-continuation';
import { asRecords } from './checkout-messages';

const bankUrl = z.url({ protocol: /^https$/ });

export function bankVerification(checkout: UcpCheckout, business: string) {
  if (
    checkout.status !== 'requires_escalation' ||
    !asRecords(checkout.messages).some(
      (message) => message.code === 'requires_3ds',
    )
  ) {
    return;
  }

  const { data: link } = bankUrl.safeParse(checkout.continue_url);

  return {
    link,
    instruction: link
      ? 'Checkout pending. Only the buyer should open the bank verification link. Wait for the buyer to finish, then retrieve this checkout.'
      : 'Checkout pending. Bank verification is required, but no usable link is available. Retrieve this checkout to check for a link or updated status.',
    _next: buildCommandContinuation('ucp', [
      'checkout',
      'retrieve',
      checkout.id,
      '--business',
      business,
    ]),
  };
}

export function agentCheckout(checkout: UcpCheckout, business: string) {
  const verification = bankVerification(checkout, business);
  if (!verification) return checkout;
  return {
    ...checkout,
    instruction: verification.instruction,
    _next: verification._next,
  };
}
