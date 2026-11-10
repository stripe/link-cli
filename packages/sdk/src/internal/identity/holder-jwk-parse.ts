import { LinkConfigurationError } from '../../errors';
import type { HolderPublicJwk } from '../../resources/interfaces';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
