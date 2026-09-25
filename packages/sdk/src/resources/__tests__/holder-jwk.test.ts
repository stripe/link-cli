import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  holderJwksEqual,
  holderJwkThumbprint,
  parseHolderPublicJwk,
} from '@/resources/holder-jwk';

function ed25519PublicJwk(): { kty: 'OKP'; crv: 'Ed25519'; x: string } {
  const { publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

describe('parseHolderPublicJwk', () => {
  it('accepts an Ed25519 public JWK and strips extra members', () => {
    const jwk = ed25519PublicJwk();
    expect(
      parseHolderPublicJwk({ ...jwk, alg: 'EdDSA', kid: 'unused' }),
    ).toEqual(jwk);
  });

  it('normalizes a private JWK to its public members', () => {
    const jwk = ed25519PublicJwk();
    expect(parseHolderPublicJwk({ ...jwk, d: 'private' })).toEqual(jwk);
  });

  it('rejects unsupported key types', () => {
    expect(() =>
      parseHolderPublicJwk({
        kty: 'EC',
        crv: 'P-256',
        x: 'x',
        y: 'y',
      }),
    ).toThrow('Ed25519 OKP');
  });
});

describe('holderJwkThumbprint', () => {
  it('is RFC 7638 SHA-256 base64url and distinguishes keys', () => {
    const left = ed25519PublicJwk();
    const right = ed25519PublicJwk();
    const thumbprint = holderJwkThumbprint(left);
    expect(thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(holderJwksEqual(left, left)).toBe(true);
    expect(holderJwksEqual(left, right)).toBe(false);
  });
});
