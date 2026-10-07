import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, it } from 'vitest';
import { clearJwksCache, LinkVerifier } from '@/index';
import { importJwkForVerify, type Jwk, type JwsAlg } from '@/internal/crypto';
import { combineFetch, LinkFixture } from '@/testing/index';

const AUD = 'https://events.example';
const NONCE = 'registration-nonce';
const NOW = 1800000000;
const segment = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

function signingKey(alg: JwsAlg) {
  const pair =
    alg === 'EdDSA'
      ? generateKeyPairSync('ed25519')
      : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    jwk: {
      ...pair.publicKey.export({ format: 'jwk' }),
      alg,
      use: 'sig',
      key_ops: ['verify'],
    } as Jwk,
    privateJwk: pair.privateKey.export({ format: 'jwk' }) as Jwk,
    compact(
      payload: Record<string, unknown>,
      header: Record<string, unknown>,
    ): string {
      const input = `${segment({ alg, ...header })}.${segment(payload)}`;
      const signature = sign(
        alg === 'EdDSA' ? null : 'sha256',
        Buffer.from(input),
        {
          key: pair.privateKey,
          dsaEncoding: 'ieee-p1363',
        },
      );
      return `${input}.${signature.toString('base64url')}`;
    },
  };
}

// Sign with Node, independently of jose and the SDK's credential fixture.
async function setup(issuerAlg: JwsAlg, holderAlg: JwsAlg) {
  clearJwksCache();
  const issuerKey = signingKey(issuerAlg);
  const holderKey = signingKey(holderAlg);
  const link = await LinkFixture.create();
  const verifier = new LinkVerifier({
    origin: AUD,
    now: () => NOW,
    fetchImpl: combineFetch(link.fetchImpl(), async (input) =>
      input.toString().endsWith('/jwks.json')
        ? Response.json({ keys: [issuerKey.jwk] })
        : new Response('not found', { status: 404 }),
    ),
  });
  const disclosure = segment([
    'independent-salt',
    'email',
    'guest@example.com',
  ]);
  const options = { nonce: NONCE, requiredClaims: ['email'] };
  return {
    verifier,
    options,
    holderKey,
    present(
      overrides: {
        issuerHeader?: Record<string, unknown>;
        holderHeader?: Record<string, unknown>;
        issuerPayload?: Record<string, unknown>;
        holderPayload?: Record<string, unknown>;
      } = {},
    ) {
      const issuerJwt = issuerKey.compact(
        {
          iss: link.issuer,
          vct: `${link.issuer}/identity/credentials/v1`,
          exp: NOW + 60,
          nbf: NOW,
          cnf: { jwk: holderKey.jwk },
          _sd: [digest(disclosure)],
          _sd_alg: 'sha-256',
          ...overrides.issuerPayload,
        },
        { typ: 'dc+sd-jwt', ...overrides.issuerHeader },
      );
      const sdPart = `${issuerJwt}~${disclosure}~`;
      return (
        sdPart +
        holderKey.compact(
          {
            aud: AUD,
            nonce: NONCE,
            iat: NOW,
            sd_hash: digest(sdPart),
            ...overrides.holderPayload,
          },
          { typ: 'kb+jwt', ...overrides.holderHeader },
        )
      );
    },
  };
}

for (const issuerAlg of ['EdDSA', 'ES256'] as const) {
  for (const holderAlg of ['EdDSA', 'ES256'] as const) {
    describe(`jose verifies ${issuerAlg} issuer / ${holderAlg} holder`, () => {
      it('accepts independent signatures and preserves audience, nonce and time checks', async () => {
        const { verifier, options, present } = await setup(
          issuerAlg,
          holderAlg,
        );
        const result = await verifier.verifyClaims(present(), options);
        assert.equal(result.valid, true);
        if (result.valid)
          assert.equal(result.claims.email, 'guest@example.com');
        for (const overrides of [
          { holderPayload: { aud: 'https://other.example' } },
          { holderPayload: { nonce: 'other-nonce' } },
          { holderPayload: { iat: NOW - 61 } },
          { holderPayload: { sd_hash: 'wrong-digest' } },
          { issuerPayload: { exp: NOW } },
          { issuerPayload: { nbf: NOW + 1 } },
        ]) {
          const rejected = await verifier.verifyClaims(
            present(overrides),
            options,
          );
          assert.equal(rejected.valid, false, JSON.stringify(overrides));
          if (!rejected.valid)
            assert.equal(
              rejected.failures[0]?.code,
              'invalid_claims_presentation',
            );
        }
        assert.equal(
          (await verifier.verifyClaims(present(), options)).valid,
          true,
        );
      });

      it('rejects critical headers and unencoded payloads in either signed JWT', async () => {
        const { verifier, options, present } = await setup(
          issuerAlg,
          holderAlg,
        );
        for (const which of ['issuerHeader', 'holderHeader']) {
          for (const header of [
            { crit: ['future'], future: true },
            { crit: [] },
            { crit: 'future' },
            { crit: ['b64'], b64: false },
          ]) {
            const result = await verifier.verifyClaims(
              present({ [which]: header }),
              options,
            );
            assert.equal(
              result.valid,
              false,
              `${which}: ${JSON.stringify(header)}`,
            );
            if (!result.valid)
              assert.equal(
                result.failures[0]?.code,
                'invalid_claims_presentation',
              );
          }
        }
        assert.equal(
          (
            await verifier.verifyClaims(
              present({ issuerHeader: { future: true } }),
              options,
            )
          ).valid,
          true,
        );
      });
    });
  }
}

describe('JWK restrictions across the jose import boundary', () => {
  for (const alg of ['EdDSA', 'ES256'] as const) {
    it(`preserves ${alg} public-key and metadata restrictions`, async () => {
      const key = signingKey(alg);
      for (const jwk of [
        { ...key.jwk, use: 'enc' },
        { ...key.jwk, alg: 'HS256' },
        { ...key.jwk, key_ops: ['sign'] },
        { ...key.jwk, key_ops: [] },
        { ...key.privateJwk },
        { kty: 'oct', k: 'YWJj' },
        { ...key.jwk, crv: alg === 'EdDSA' ? 'Ed448' : 'P-384' },
      ]) {
        await assert.rejects(importJwkForVerify(jwk, alg));
      }
      const imported = await importJwkForVerify(
        { ...key.jwk, ext: false },
        alg,
      );
      assert.equal(imported.type, 'public');
      assert.equal(imported.extractable, false);
      assert.deepEqual(imported.usages, ['verify']);
      if (alg === 'EdDSA') {
        assert.equal(
          (await importJwkForVerify({ ...key.jwk, alg: 'Ed25519' }, alg)).type,
          'public',
        );
      }
    });
  }
});
