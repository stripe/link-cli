import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearJwksCache } from '../src/claims.js';
import { LinkVerifier, VerificationError } from '../src/index.js';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '../src/testing/index.js';
import { assertFailed, firstFailure } from './helpers.js';

const MERCHANT = 'https://shop.example';

async function setup() {
  clearJwksCache();
  const link = await LinkFixture.create();
  const cred = await CredentialFixture.create({
    issuerUrl: link.issuer,
    claims: { email: 'ada@example.com', given_name: 'Ada' },
  });
  const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
  const verifier = new LinkVerifier({ origin: MERCHANT, fetchImpl });
  return { link, cred, verifier, fetchImpl };
}

describe('LinkVerifier configuration', () => {
  it('requires an origin for claim audiences but no agent directory configuration', () => {
    assert.throws(() => new LinkVerifier({ origin: '' }), /requires an origin/);
    assert.throws(
      () => new LinkVerifier({ origin: 'https://' }),
      /not a usable authority/,
    );
    assert.ok(new LinkVerifier({ origin: MERCHANT }));
  });

  it('accepts a full origin or a bare authority for claims', async () => {
    const { fetchImpl } = await setup();
    for (const origin of [MERCHANT, 'shop.example', 'shop.example:443']) {
      const verifier = new LinkVerifier({ origin, fetchImpl });
      const challenge = await verifier.claimsChallenge({ claims: ['email'] });
      assert.equal(challenge.body.aud, MERCHANT);
    }
  });

  it('preserves an explicit HTTP audience when challenging and verifying claims', async () => {
    const { cred, fetchImpl } = await setup();
    const origin = 'http://localhost:3000';
    const verifier = new LinkVerifier({ origin, fetchImpl });
    const challenge = await verifier.claimsChallenge({ claims: ['email'] });
    assert.equal(challenge.body.aud, origin);
    const options = { nonce: challenge.nonce, requiredClaims: ['email'] };
    const present = (aud: string) =>
      cred.present({ aud, nonce: challenge.nonce, disclose: ['email'] });

    const wrongScheme = await verifier.verifyClaims(
      await present('https://localhost:3000'),
      options,
    );
    assertFailed(wrongScheme, 'invalid_claims_presentation');
    assert.match(firstFailure(wrongScheme).message, /aud does not match/);
    assert.equal(
      (await verifier.verifyClaims(await present(origin), options)).valid,
      true,
    );
    assert.throws(
      () => new LinkVerifier({ origin: 'ftp://localhost:3000' }),
      /not a usable authority/,
    );
  });

  for (const offset of [-86400, 86400]) {
    it(`reports the suggested nonce expiry with a clock ${offset < 0 ? 'behind' : 'ahead of'} wall time`, async () => {
      clearJwksCache();
      let now = Math.floor(Date.now() / 1000) + offset;
      const link = await LinkFixture.create();
      const cred = await CredentialFixture.create({
        issuerUrl: link.issuer,
        claims: { email: 'ada@example.com' },
        extraPayload: { exp: now + 60 },
      });
      const verifier = new LinkVerifier({
        origin: MERCHANT,
        now: () => now,
        fetchImpl: combineFetch(link.fetchImpl(), cred.fetchImpl()),
      });
      const active = await verifier.claimsChallenge({
        claims: ['email'],
        nonceTtlSeconds: 2,
      });
      assert.equal(active.expiresAt, now + 2);
      now += 2;
      assert.equal(active.expiresAt, now);
    });
  }

  it('does not imply audience binding for bearer AATs', async () => {
    const { link, verifier, fetchImpl } = await setup();
    const token = await link.mint();
    const other = new LinkVerifier({
      origin: 'https://other.example',
      fetchImpl,
    });
    assert.equal(
      (await verifier.verifyAttestation(token.authorization)).valid,
      true,
    );
    assert.equal(
      (await other.verifyAttestation(token.authorization)).valid,
      true,
    );
  });
});

describe('the credential flow through the facade', () => {
  it('challenges and verifies attestations and holder-bound claims without WBA', async () => {
    const { link, cred, verifier } = await setup();
    const challenge = await verifier.attestationChallenge();
    assert.ok(challenge.wwwAuthenticate.length >= 1);
    const token = await link.mint();
    const attested = await verifier.verifyAttestationOrThrow(
      token.authorization,
    );
    assert.equal(attested.issuer, link.issuer);

    const claimsChallenge = await verifier.claimsChallenge({
      claims: ['email'],
    });
    const presentation = await cred.present({
      aud: claimsChallenge.body.aud,
      nonce: claimsChallenge.nonce,
      disclose: ['email'],
    });
    const result = await verifier.verifyClaimsOrThrow(presentation, {
      nonce: claimsChallenge.nonce,
      requiredClaims: ['email'],
    });
    assert.deepEqual(result.claims, { email: 'ada@example.com' });
    assert.equal(result.holderKeyThumbprint, cred.holderThumbprint);

    const replay = await verifier.verifyClaims(presentation, {
      nonce: claimsChallenge.nonce,
      requiredClaims: ['email'],
    });
    assert.equal(
      replay.valid,
      true,
      'replay policy belongs to the application',
    );
  });

  it('still rejects a claims presentation for another audience', async () => {
    const { cred, verifier } = await setup();
    const challenge = await verifier.claimsChallenge({ claims: ['email'] });
    const presentation = await cred.present({
      aud: 'https://other.example',
      nonce: challenge.nonce,
      disclose: ['email'],
    });
    const options = { nonce: challenge.nonce, requiredClaims: ['email'] };
    const result = await verifier.verifyClaims(presentation, options);
    assertFailed(result, 'invalid_claims_presentation');
    assert.match(firstFailure(result).message, /aud does not match/);
    await assert.rejects(
      () => verifier.verifyClaimsOrThrow(presentation, options),
      VerificationError,
    );
  });

  it('rejects absent credentials and the old request-object input', async () => {
    const { verifier } = await setup();
    for (const value of [null, undefined, '']) {
      assertFailed(
        await verifier.verifyClaims(value, { nonce: 'n', requiredClaims: [] }),
        'incomplete_protocol_request',
      );
      await assert.rejects(
        () => verifier.verifyAttestationOrThrow(value),
        VerificationError,
      );
    }
    assertFailed(
      await verifier.verifyClaims({ headers: [] } as unknown as string, {
        nonce: 'n',
        requiredClaims: [],
      }),
      'malformed_protocol_input',
    );
  });

  it('extracts credentials without inspecting WBA headers or consuming the body', async () => {
    const { link, verifier } = await setup();
    const token = await link.mint();
    const request = new Request(`${MERCHANT}/orders`, {
      method: 'POST',
      headers: {
        Authorization: token.authorization,
        Signature: 'invalid and ignored',
        'Signature-Input': 'invalid and ignored',
        'Signature-Agent': 'https://untrusted.example/keys',
        'Content-Digest': 'invalid and ignored',
      },
      body: '{"amount":100}',
    });
    assert.equal(
      (await verifier.verifyAttestation(request.headers.get('Authorization')))
        .valid,
      true,
    );
    assert.equal(request.bodyUsed, false);
    assert.deepEqual(await request.json(), { amount: 100 });
  });

  it('rejects a combined Authorization field containing two credentials', async () => {
    const { link, verifier } = await setup();
    const token = await link.mint();
    const headers = new Headers();
    headers.append('Authorization', token.authorization);
    headers.append('Authorization', token.authorization);
    assertFailed(
      await verifier.verifyAttestation(headers.get('Authorization')),
      'malformed_protocol_input',
    );
  });
});
