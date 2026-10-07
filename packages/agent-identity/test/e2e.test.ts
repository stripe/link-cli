import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { clearJwksCache } from '../src/claims.js';
import {
  createAttestationChallenge,
  createClaimsChallenge,
  LinkIssuer,
  verifyAttestation,
  verifyClaimsPresentation,
} from '../src/index.js';
import { toBase64url } from '../src/internal/bytes.js';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '../src/testing/index.js';
import { assertFailed, firstFailure } from './helpers.js';

async function setup() {
  const link = await LinkFixture.create();
  const issuer = new LinkIssuer({
    fetchImpl: link.fetchImpl(),
    minRefreshSeconds: 0,
  });
  return { link, issuer };
}

describe('verifyAttestation, end to end', () => {
  it('verifies a bearer AAT without request metadata or Web Bot Auth', async () => {
    const { link } = await setup();
    const urls: string[] = [];
    const issuer = new LinkIssuer({
      fetchImpl: (async (input, init) => {
        urls.push(input.toString());
        return link.fetchImpl()(input, init);
      }) as typeof fetch,
    });
    const challenge = await createAttestationChallenge(issuer);
    assert.equal(challenge.wwwAuthenticate.length, 1);
    const token = await link.mint();
    const result = await verifyAttestation(token.authorization, { issuer });
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.issuer, 'https://api.link.com');
      assert.equal(result.bindingMode, 'bearer');
      assert.ok(!('agentKeyThumbprint' in result));
      assert.ok(!('signatureCreated' in result));
    }
    assert.deepEqual(urls, [
      'https://api.link.com/.well-known/aap-issuer',
      'https://api.link.com/.well-known/aap-issuer/token-keys',
    ]);
  });

  it('rejects a key-bound AAT rather than treating it as bearer', async () => {
    const { link, issuer } = await setup();
    const token = await link.mint({
      agentKeyThumbprint: new Uint8Array(32).fill(7),
    });
    const result = await verifyAttestation(token.authorization, { issuer });
    assertFailed(result, 'challenge_mismatch');
    assert.match(
      firstFailure(result).message,
      /key-bound tokens are not supported/,
    );
  });

  it('rejects an incorrect challenge digest even with a valid issuer signature', async () => {
    const { link, issuer } = await setup();
    const token = await link.mint({
      challengeDigestOverride: new Uint8Array(32),
    });
    assertFailed(
      await verifyAttestation(token.authorization, { issuer }),
      'challenge_mismatch',
    );
  });

  it('rejects a corrupted authenticator', async () => {
    const { link, issuer } = await setup();
    const token = await link.mint({ corruptAuthenticator: true });
    assertFailed(
      await verifyAttestation(token.authorization, { issuer }),
      'invalid_private_token',
    );
  });

  it('rejects a token whose nonce was changed after issuance', async () => {
    const { link, issuer } = await setup();
    const token = await link.mint();
    token.raw[2] = (token.raw[2] as number) ^ 1;
    assertFailed(
      await verifyAttestation(
        `PrivateToken token="${toBase64url(token.raw)}"`,
        { issuer },
      ),
      'invalid_private_token',
    );
  });

  it('rejects unknown issuer keys', async () => {
    const { issuer } = await setup();
    const other = await LinkFixture.create();
    const token = await other.mint();
    assertFailed(
      await verifyAttestation(token.authorization, { issuer }),
      'unknown_issuer',
    );
  });

  it('reports absent, malformed, and ambiguous credentials without throwing', async () => {
    const { link, issuer } = await setup();
    for (const value of [null, undefined, '']) {
      assertFailed(
        await verifyAttestation(value, { issuer }),
        'incomplete_protocol_request',
      );
    }
    const token = await link.mint();
    for (const value of [
      'Bearer abc',
      'PrivateToken token="bad"',
      `${token.authorization}, token="bad"`,
      `${token.authorization}, ${token.authorization}`,
      { headers: [] } as unknown as string,
    ]) {
      assertFailed(
        await verifyAttestation(value, { issuer }),
        'malformed_protocol_input',
      );
    }
  });

  it('does not enforce AAT single use', async () => {
    const { link, issuer } = await setup();
    const token = await link.mint();
    assert.equal(
      (await verifyAttestation(token.authorization, { issuer })).valid,
      true,
    );
    assert.equal(
      (await verifyAttestation(token.authorization, { issuer })).valid,
      true,
    );
  });
});

describe('verifyClaimsPresentation', () => {
  it('accepts a presentation disclosing exactly what was asked for', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: {
        email: 'a@example.com',
        given_name: 'Ada',
        family_name: 'Lovelace',
      },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });

    const challenge = await createClaimsChallenge(issuer, {
      audience: 'https://merchant.example',
      claims: ['email', 'given_name'],
      purpose: 'Put a contact on the order',
    });
    assert.deepEqual(challenge.body.trusted_issuers, ['https://api.link.com']);

    const presentation = await cred.present({
      aud: challenge.body.aud,
      nonce: challenge.nonce,
      disclose: ['email', 'given_name'],
    });

    const result = await verifyClaimsPresentation({
      presentation,
      audience: challenge.body.aud,
      nonce: challenge.nonce,
      issuer,
      requiredClaims: ['email', 'given_name'],
      fetchImpl,
    });
    assert.equal(
      result.valid,
      true,
      result.valid ? '' : JSON.stringify(result.failures),
    );
    if (result.valid) {
      assert.deepEqual(result.claims, {
        email: 'a@example.com',
        given_name: 'Ada',
      });
      assert.equal(result.holderKeyThumbprint, cred.holderThumbprint);
      assert.ok(
        !('family_name' in result.claims),
        'undisclosed claims stay hidden',
      );
    }
  });

  it('leaves presentation replay policy to the adopter', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: { email: 'a@example.com' },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });

    const challenge = await createClaimsChallenge(issuer, {
      audience: 'https://merchant.example',
      claims: ['email'],
    });
    const presentation = await cred.present({
      aud: challenge.body.aud,
      nonce: challenge.nonce,
      disclose: ['email'],
    });
    const args = {
      presentation,
      audience: challenge.body.aud,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
      requiredClaims: ['email'],
    };

    assert.equal((await verifyClaimsPresentation(args)).valid, true);
    const second = await verifyClaimsPresentation(args);
    assert.equal(second.valid, true);
  });

  it('rejects a presentation bound to a different audience', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: { email: 'a@example.com' },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    const challenge = await createClaimsChallenge(issuer, {
      audience: 'https://merchant.example',
      claims: ['email'],
    });

    const presentation = await cred.present({
      aud: 'https://other.example',
      nonce: challenge.nonce,
      disclose: ['email'],
    });
    const result = await verifyClaimsPresentation({
      presentation,
      audience: challenge.body.aud,
      nonce: challenge.nonce,
      issuer,
      requiredClaims: [],
      fetchImpl,
    });
    assert.equal(result.valid, false);
    assert.match(firstFailure(result).message, /aud does not match/);
  });

  it('rejects a disclosure added after the holder signed', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: { email: 'a@example.com', given_name: 'Ada' },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    const challenge = await createClaimsChallenge(issuer, {
      audience: 'https://merchant.example',
      claims: ['email'],
    });

    // Holder discloses only email. An intermediary splices given_name in.
    const presentation = await cred.present({
      aud: challenge.body.aud,
      nonce: challenge.nonce,
      disclose: ['email'],
    });
    const parts = presentation.split('~');
    const kb = parts.pop()!;
    const spliced = [...parts, cred.disclosures[1], kb].join('~');

    const result = await verifyClaimsPresentation({
      presentation: spliced,
      audience: challenge.body.aud,
      nonce: challenge.nonce,
      issuer,
      requiredClaims: [],
      fetchImpl,
    });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(firstFailure(result).message, /sd_hash does not match/);
    }
  });

  it('rejects a presentation with no Key Binding JWT', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: { email: 'a@example.com' },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    const challenge = await createClaimsChallenge(issuer, {
      audience: 'https://merchant.example',
      claims: ['email'],
    });

    const result = await verifyClaimsPresentation({
      presentation: `${cred.issuerJwt}~${cred.disclosures[0]}~`,
      audience: challenge.body.aud,
      nonce: challenge.nonce,
      issuer,
      fetchImpl,
    });
    assert.equal(result.valid, false);
    assert.match(firstFailure(result).message, /no Key Binding JWT/);
  });

  it('rejects a KB-JWT with the wrong typ', async () => {
    clearJwksCache();
    const link = await LinkFixture.create('https://api.link.com', 1);
    const cred = await CredentialFixture.create({
      issuerUrl: 'https://api.link.com',
      claims: { email: 'a@example.com' },
    });
    const fetchImpl = combineFetch(link.fetchImpl(), cred.fetchImpl());
    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    const challenge = await createClaimsChallenge(issuer, {
      audience: 'https://merchant.example',
      claims: ['email'],
    });

    const presentation = await cred.present({
      aud: challenge.body.aud,
      nonce: challenge.nonce,
      disclose: ['email'],
      typOverride: 'JWT',
    });
    const result = await verifyClaimsPresentation({
      presentation,
      audience: challenge.body.aud,
      nonce: challenge.nonce,
      issuer,
      requiredClaims: [],
      fetchImpl,
    });
    assert.equal(result.valid, false);
    assert.match(firstFailure(result).message, /typ/);
  });

  it('refuses to request a claim Link does not advertise', async () => {
    const link = await LinkFixture.create('https://api.link.com', 1);
    const issuer = new LinkIssuer({
      fetchImpl: link.fetchImpl(),
      minRefreshSeconds: 0,
    });
    await assert.rejects(
      () =>
        createClaimsChallenge(issuer, {
          audience: 'https://merchant.example',
          claims: ['email', 'passport_number'],
        }),
      /does not advertise: passport_number/,
    );
  });
});
