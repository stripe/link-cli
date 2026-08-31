import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CREDENTIAL_HEADER,
  PAYMENT_AUTHORIZATION_HEADER,
  canonicalizeCredentialHeader,
  shouldEchoCredentialHeader,
} from './credential-header';

describe('canonicalizeCredentialHeader', () => {
  it('treats omitted and Authorization values as the default', () => {
    expect(canonicalizeCredentialHeader(undefined)).toBe(
      DEFAULT_CREDENTIAL_HEADER,
    );
    expect(canonicalizeCredentialHeader('authorization')).toBe(
      DEFAULT_CREDENTIAL_HEADER,
    );
  });

  it('accepts Payment-Authorization', () => {
    expect(canonicalizeCredentialHeader('Payment-Authorization')).toBe(
      PAYMENT_AUTHORIZATION_HEADER,
    );
  });

  it('rejects an unsupported advertised header', () => {
    expect(() => canonicalizeCredentialHeader('X-Payment')).toThrow(
      /Unsupported payment credential header/i,
    );
  });

  it('echoes only non-default headers', () => {
    expect(shouldEchoCredentialHeader(DEFAULT_CREDENTIAL_HEADER)).toBe(false);
    expect(shouldEchoCredentialHeader(PAYMENT_AUTHORIZATION_HEADER)).toBe(true);
  });
});
