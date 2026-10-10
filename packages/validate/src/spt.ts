import { z } from 'zod';
import type { PaymentAdapter } from './seller.ts';

const amount = 100;
const currency = 'usd';
const purchaseBody = z.object({ spt: z.string().startsWith('spt_').max(512) });
const paymentIntent = z.object({
  id: z.string().startsWith('pi_'),
  status: z.literal('succeeded'),
  livemode: z.literal(false),
  amount: z.literal(amount),
  currency: z.literal(currency),
});

export function createSptAdapter(
  secretKey: string,
  fetchStripe: typeof fetch = fetch,
): PaymentAdapter {
  if (!/^(sk|rk)_test_\S+$/.test(secretKey)) {
    throw new Error(
      'Use a seller sandbox key (sk_test_... or rk_test_...). Live keys and claimable sandbox keys (rkcs_...) cannot accept SPTs; run `stripe login` for a sandbox key.',
    );
  }

  return {
    fixInstructions:
      'Get a fresh test SPT for the network ID and total in the purchase API, wait for approval and the token itself, submit it as documented, and keep the confirmation token.',
    documentation: {
      amount,
      currency,
      test_mode: true,
      network_id: 'profile_test_seller',
      purchase: {
        method: 'POST',
        path: '/purchase',
        content_type: 'application/json',
        body: { spt: '<test shared payment token for this seller and total>' },
      },
    },
    async purchase(body, runId) {
      const parsed = purchaseBody.safeParse(body);
      if (!parsed.success) {
        return { status: 400, error: 'Submit an SPT in the spt field.' };
      }

      const response = await fetchStripe(
        'https://api.stripe.com/v1/payment_intents',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Stripe-Version': '2026-07-29.preview',
            // One fixed purchase per run, even if the caller retries.
            'Idempotency-Key': `link_validate_${runId}`,
          },
          body: new URLSearchParams({
            amount: String(amount),
            currency,
            confirm: 'true',
            'automatic_payment_methods[enabled]': 'true',
            'automatic_payment_methods[allow_redirects]': 'never',
            shared_payment_granted_token: parsed.data.spt,
            'metadata[link_validation_run]': runId,
          }),
        },
      );
      const verified = paymentIntent.safeParse(await response.json());
      if (!verified.success) {
        return {
          status: 422,
          terminal: true,
          error:
            'Stripe did not confirm the expected sandbox payment. Check the seller sandbox request logs, then start a new validation run.',
        };
      }
      return { payment: { payment_intent: verified.data.id } };
    },
  };
}
