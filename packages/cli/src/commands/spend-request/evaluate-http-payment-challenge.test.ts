import { Challenge } from 'mppx';
import { usdce } from 'viem/tokens';
import { describe, expect, it } from 'vitest';
import {
  evaluateHttpPaymentChallenge,
  MalformedHttpPaymentChallenge,
  UnsupportedHttpPaymentChallenge,
} from './evaluate-http-payment-challenge';

function paymentChallenge({
  method = 'tempo',
  amount = '1230000',
  currency = usdce.addresses[4217],
  recipient = '0x1234567890123456789012345678901234567890',
  chainId = 4217,
  intent = 'charge',
  expires = '2027-01-01T00:00:00Z',
}: {
  method?: string;
  amount?: unknown;
  currency?: unknown;
  recipient?: unknown;
  chainId?: unknown;
  intent?: string;
  expires?: string;
} = {}): string {
  return Challenge.serialize({
    id: 'challenge-id',
    realm: 'merchant.example',
    method,
    intent,
    expires,
    request: {
      recipient,
      amount,
      currency,
      methodDetails: { chainId },
    },
  });
}

describe('evaluateHttpPaymentChallenge', () => {
  it('decodes raw Tempo payment terms and normalizes USDC base units', () => {
    const result = evaluateHttpPaymentChallenge(paymentChallenge());

    expect(result).toMatchObject({
      amount: 123n,
      currency: 'usd',
      payment_request: {
        recipient: '0x1234567890123456789012345678901234567890',
        amount_base_units: 1230000n,
        currency: usdce.addresses[4217],
        chain_id: 4217n,
      },
    });
  });

  it('rejects malformed challenge headers', () => {
    expect(() => evaluateHttpPaymentChallenge('%%%')).toThrow(
      MalformedHttpPaymentChallenge,
    );
  });

  it('rejects missing payment terms', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ recipient: '' })),
    ).toThrow(MalformedHttpPaymentChallenge);
  });

  it('rejects a challenge without a Tempo method', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ method: 'stripe' })),
    ).toThrow(UnsupportedHttpPaymentChallenge);
  });

  it('rejects a Tempo amount below one cent', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ amount: '9999' })),
    ).toThrow(UnsupportedHttpPaymentChallenge);
  });

  it('rejects a sub-cent amount', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ amount: '10001' })),
    ).toThrow(UnsupportedHttpPaymentChallenge);
  });

  it('rejects a different Tempo chain', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ chainId: 8453 })),
    ).toThrow(UnsupportedHttpPaymentChallenge);
  });

  it('rejects a non-EVM recipient', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ recipient: 'wallet' })),
    ).toThrow(MalformedHttpPaymentChallenge);
  });

  it('rejects a non-charge intent', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ intent: 'session' })),
    ).toThrow(UnsupportedHttpPaymentChallenge);
  });

  it('rejects an invalid expiry', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ expires: '' })),
    ).toThrow(MalformedHttpPaymentChallenge);
  });

  it('rejects an unsupported currency', () => {
    expect(() =>
      evaluateHttpPaymentChallenge(paymentChallenge({ currency: 'eurc' })),
    ).toThrow(UnsupportedHttpPaymentChallenge);
  });
});
