import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createClaimsChallenge } from '../src/challenge.js';
import { clearJwksCache } from '../src/claims.js';
import {
  FAILURE_CODES,
  isRejection,
  REJECTION_CODES,
  VerificationError,
  verifyAttestation,
  verifyAttestationOrThrow,
  verifyClaimsPresentationOrThrow,
} from '../src/index.js';
import { LinkIssuer } from '../src/issuer.js';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '../src/testing/index.js';
import { assertFailed } from './helpers.js';

const AUD = 'https://merchant.example';

describe('upstream faults are results, not exceptions', () => {
  for (const [name, broken] of [
    [
      'unreachable',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
    ['HTTP 500', async () => new Response('boom', { status: 500 })],
    ['non-JSON', async () => new Response('<html>gateway error</html>')],
  ] as const) {
    it(`reports an ${name} issuer as issuer_unavailable`, async () => {
      const link = await LinkFixture.create();
      const token = await link.mint();
      const issuer = new LinkIssuer({ fetchImpl: broken as typeof fetch });
      assertFailed(
        await verifyAttestation(token.authorization, { issuer }),
        'issuer_unavailable',
      );
    });
  }
});

describe('rejection versus unavailability', () => {
  it('separates bad credentials from issuer failures', () => {
    for (const code of FAILURE_CODES) {
      assert.equal(
        isRejection({ code, message: '' }),
        code !== 'issuer_unavailable',
      );
    }
    assert.equal(REJECTION_CODES.length, FAILURE_CODES.length - 1);
  });

  it('exposes only the token and claims failure codes', () => {
    assert.deepEqual(FAILURE_CODES, [
      'incomplete_protocol_request',
      'malformed_protocol_input',
      'invalid_private_token',
      'challenge_mismatch',
      'unknown_issuer',
      'invalid_claims_presentation',
      'issuer_unavailable',
    ]);
  });
});

describe('the OrThrow variants', () => {
  it('throws VerificationError carrying the same failures', async () => {
    const link = await LinkFixture.create();
    const issuer = new LinkIssuer({ fetchImpl: link.fetchImpl() });
    await assert.rejects(
      () => verifyAttestationOrThrow(null, { issuer }),
      (error: unknown) => {
        assert.ok(error instanceof VerificationError);
        assert.equal(error.code, 'incomplete_protocol_request');
        assert.equal(error.failures.length, 1);
        return true;
      },
    );
  });

  it('returns the token verification result on success', async () => {
    const link = await LinkFixture.create();
    const token = await link.mint();
    const issuer = new LinkIssuer({ fetchImpl: link.fetchImpl() });
    const result = await verifyAttestationOrThrow(token.authorization, {
      issuer,
    });
    assert.equal(result.issuer, link.issuer);
    assert.equal(result.bindingMode, 'bearer');
  });

  it('exist for the claims lane too', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: { email: 'a@example.com' },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    const challenge = await createClaimsChallenge(issuer, {
      audience: AUD,
      claims: ['email'],
    });

    const success = await verifyClaimsPresentationOrThrow({
      presentation: await cred.present({
        aud: AUD,
        nonce: challenge.nonce,
        disclose: ['email'],
      }),
      audience: AUD,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    });
    assert.deepEqual(success.claims, { email: 'a@example.com' });
  });
});
