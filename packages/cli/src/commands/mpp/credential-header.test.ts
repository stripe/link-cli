import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREDENTIAL_HEADER,
  PAYMENT_AUTHORIZATION_HEADER,
  canonicalizeCredentialHeader,
  resolvePaymentCredentialHeader,
  shouldEchoCredentialHeader,
} from './credential-header';

const STRIPE_REQUEST = Buffer.from(
  JSON.stringify({
    amount: '1000',
    currency: 'usd',
    methodDetails: { networkId: 'net_001', paymentMethodTypes: ['card'] },
  }),
).toString('base64');

describe('resolvePaymentCredentialHeader', () => {
  it('defaults to Authorization when the challenge omits header', () => {
    const wwwAuthenticate = [
      'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge",',
      `request="${STRIPE_REQUEST}"`,
    ].join(' ');

    expect(resolvePaymentCredentialHeader(wwwAuthenticate, 'ch_001')).toBe(
      DEFAULT_CREDENTIAL_HEADER,
    );
  });

  it('uses Payment-Authorization when the stripe challenge advertises it', () => {
    const wwwAuthenticate = [
      'Payment id="tempo_001", realm="merchant.example", method="tempo", intent="charge", request="e30=",',
      'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge",',
      'header="Payment-Authorization",',
      `request="${STRIPE_REQUEST}"`,
    ].join(' ');

    expect(resolvePaymentCredentialHeader(wwwAuthenticate, 'ch_001')).toBe(
      PAYMENT_AUTHORIZATION_HEADER,
    );
  });

  it('does not inherit header from a different Payment challenge', () => {
    const wwwAuthenticate = [
      'Payment id="tempo_001", realm="merchant.example", method="tempo", intent="charge",',
      'header="Payment-Authorization", request="e30=",',
      'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge",',
      `request="${STRIPE_REQUEST}"`,
    ].join(' ');

    expect(resolvePaymentCredentialHeader(wwwAuthenticate, 'ch_001')).toBe(
      DEFAULT_CREDENTIAL_HEADER,
    );
  });

  it('rejects an unsupported advertised header', () => {
    const wwwAuthenticate = [
      'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge",',
      'header="X-Payment",',
      `request="${STRIPE_REQUEST}"`,
    ].join(' ');

    expect(() =>
      resolvePaymentCredentialHeader(wwwAuthenticate, 'ch_001'),
    ).toThrow(/Unsupported payment credential header/i);
  });
});

describe('canonicalizeCredentialHeader', () => {
  it('treats omitted and Authorization values as the default', () => {
    expect(canonicalizeCredentialHeader(undefined)).toBe(
      DEFAULT_CREDENTIAL_HEADER,
    );
    expect(canonicalizeCredentialHeader('authorization')).toBe(
      DEFAULT_CREDENTIAL_HEADER,
    );
  });

  it('echoes only non-default headers', () => {
    expect(shouldEchoCredentialHeader(DEFAULT_CREDENTIAL_HEADER)).toBe(false);
    expect(shouldEchoCredentialHeader(PAYMENT_AUTHORIZATION_HEADER)).toBe(true);
  });
});
