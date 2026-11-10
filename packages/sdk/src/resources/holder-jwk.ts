import { createHash } from 'node:crypto';
import { parseHolderPublicJwk } from '../internal/identity/holder-jwk-parse';
import type { HolderPublicJwk } from './interfaces';

export { parseHolderPublicJwk };

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
