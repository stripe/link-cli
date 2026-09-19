import { createHash } from 'node:crypto';
import { LinkConfigurationError } from '@/errors';
import type { HolderPublicJwk } from '@/resources/interfaces';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * RFC 7638 SHA-256 thumbprint of a holder public JWK, base64url-encoded.
 */
export function holderJwkThumbprint(jwk: HolderPublicJwk): string {
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
  });
  return createHash('sha256').update(canonical).digest('base64url');
}

export function holderJwksEqual(
  left: HolderPublicJwk,
  right: HolderPublicJwk,
): boolean {
  return holderJwkThumbprint(left) === holderJwkThumbprint(right);
}

/**
 * Normalizes a supported holder JWK to its public members.
 */
export function parseHolderPublicJwk(value: unknown): HolderPublicJwk {
  if (!isRecord(value)) {
    throw new LinkConfigurationError('Holder public key must be a JWK object');
  }
  if (typeof value.kty !== 'string') {
    throw new LinkConfigurationError('Holder public key is missing kty');
  }

  if (
    value.kty !== 'OKP' ||
    value.crv !== 'Ed25519' ||
    typeof value.x !== 'string' ||
    value.x.length === 0
  ) {
    throw new LinkConfigurationError(
      'Holder public key must be an Ed25519 OKP JWK with an x member',
    );
  }
  return { kty: 'OKP', crv: 'Ed25519', x: value.x };
}
