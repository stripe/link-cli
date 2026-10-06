import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  challengeDigestMatches,
  parsePrivateTokenCredential,
  parseToken,
  TOKEN_SIZE,
  verifyTokenSignature,
} from '../src/attestation.js';
import { createAttestationChallenge } from '../src/challenge.js';
import { fromBase64, toBase64url } from '../src/internal/bytes.js';
import { sha256 } from '../src/internal/crypto.js';
import { LinkIssuer } from '../src/issuer.js';
import { LinkFixture } from '../src/testing/index.js';

async function setup(keyCount = 1) {
  const fixture = await LinkFixture.create('https://api.link.com', keyCount);
  const issuer = new LinkIssuer({
    fetchImpl: fixture.fetchImpl(),
    minRefreshSeconds: 0,
  });
  return { fixture, issuer };
}

describe('challenge', () => {
  it('advertises one challenge per published key, sharing one stable TokenChallenge', async () => {
    const { fixture, issuer } = await setup(2);
    const challenge = await createAttestationChallenge(issuer);

    assert.equal(challenge.wwwAuthenticate.length, 2);
    const challengeValues = challenge.wwwAuthenticate.map(
      (v) => /challenge="([^"]+)"/.exec(v)![1],
    );
    assert.equal(
      new Set(challengeValues).size,
      1,
      'the TokenChallenge must not vary per key',
    );
    const keyValues = challenge.wwwAuthenticate.map(
      (v) => /token-key="([^"]+)"/.exec(v)![1],
    );
    assert.equal(new Set(keyValues).size, 2, 'each key must be advertised');
    void fixture;
  });

  it('quotes base64url parameters, since padded base64url is not a valid HTTP token', async () => {
    const { issuer } = await setup();
    const [value] = (await createAttestationChallenge(issuer)).wwwAuthenticate;
    assert.ok(value !== undefined);
    assert.match(
      value,
      /^PrivateToken challenge="[^"]+", token-key="[^"]+", max-age=\d+$/,
    );
  });

  it('is stable across calls, so pooled tokens keep verifying', async () => {
    const { issuer } = await setup();
    const a = await createAttestationChallenge(issuer);
    const b = await createAttestationChallenge(issuer);
    assert.equal(a.challengeDigest, b.challengeDigest);
  });
});

describe('token parsing', () => {
  it('round-trips a minted token', async () => {
    const { fixture } = await setup();
    const minted = await fixture.mint();
    assert.equal(minted.raw.length, TOKEN_SIZE);

    const bytes = parsePrivateTokenCredential(minted.authorization);
    assert.ok(bytes instanceof Uint8Array, 'credential should parse');
    const parsed = parseToken(bytes);
    assert.ok(typeof parsed !== 'string', `expected a token, got: ${parsed}`);
    assert.equal(parsed.tokenType, 0x0002);
    assert.equal(parsed.nonce.length, 32);
    assert.equal(parsed.tokenInput.length, 98);
  });

  it('rejects a truncated token', async () => {
    const { fixture } = await setup();
    const minted = await fixture.mint();
    const result = parseToken(minted.raw.slice(0, TOKEN_SIZE - 1));
    assert.equal(typeof result, 'string');
    assert.match(result as string, /expected 354/);
  });

  it('rejects the privately verifiable token type', async () => {
    const { fixture } = await setup();
    const minted = await fixture.mint();
    const tampered = new Uint8Array(minted.raw);
    tampered[1] = 0x01;
    const result = parseToken(tampered);
    assert.match(result as string, /unsupported token_type 0x0001/);
  });

  it('rejects a credential that is not PrivateToken', () => {
    assert.match(
      parsePrivateTokenCredential('Bearer abc') as string,
      /not a PrivateToken/,
    );
  });
});

describe('token signature', () => {
  it('verifies against the issuer key that signed it', async () => {
    const { fixture, issuer } = await setup();
    const minted = await fixture.mint();
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');

    const key = await issuer.resolveKey(parsed.tokenKeyId);
    assert.ok(key, 'token_key_id should resolve');
    assert.equal(await verifyTokenSignature(parsed, key), true);
  });

  it('rejects a corrupted authenticator', async () => {
    const { fixture, issuer } = await setup();
    const minted = await fixture.mint({ corruptAuthenticator: true });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');

    const key = await issuer.resolveKey(parsed.tokenKeyId);
    assert.ok(key);
    assert.equal(await verifyTokenSignature(parsed, key), false);
  });

  it('resolves the right key when the issuer publishes several', async () => {
    const { fixture, issuer } = await setup(3);
    for (const keyIndex of [0, 1, 2]) {
      const minted = await fixture.mint({ keyIndex });
      const parsed = parseToken(minted.raw);
      assert.ok(typeof parsed !== 'string');
      const key = await issuer.resolveKey(parsed.tokenKeyId);
      assert.ok(key, `key ${keyIndex} should resolve`);
      assert.equal(await verifyTokenSignature(parsed, key), true);
    }
  });

  it('does not resolve a key the issuer never published', async () => {
    const { issuer } = await setup();
    const bogus = toBase64url(await sha256(new Uint8Array([1, 2, 3])));
    assert.equal(await issuer.resolveKey(bogus), undefined);
  });
});

describe('challenge digest binding', () => {
  it('matches a bearer-mode token', async () => {
    const { fixture, issuer } = await setup();
    const minted = await fixture.mint();
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');

    const result = await challengeDigestMatches({
      issuerName: issuer.issuerName,
      presented: parsed.challengeDigest,
    });
    assert.deepEqual(result, { matched: true, bindingMode: 'bearer' });
  });

  it('rejects a key-bound token because no presenter key is verified', async () => {
    const { fixture, issuer } = await setup();
    const minted = await fixture.mint({
      agentKeyThumbprint: globalThis.crypto.getRandomValues(new Uint8Array(32)),
    });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    const match = await challengeDigestMatches({
      issuerName: issuer.issuerName,
      presented: parsed.challengeDigest,
    });
    assert.equal(match.matched, false);
  });

  it('rejects a token minted with a non-empty origin_info', async () => {
    // A per-origin token defeats pooling and does not verify here, because this
    // profile reconstructs the challenge with an empty origin_info.
    //
    // `origin_info` holds *server names*, per RFC 9577 section 2.1.1.1: a hostname
    // and optional port, with no scheme. An earlier version of this test used
    // `https://merchant.example`, copying the non-conformant scheme-qualified value
    // a client happened to send. Both sides then held the same misreading, so the
    // test passed while proving nothing about the conformant case. Both forms are
    // checked now, so neither can pass by accident.
    const { fixture, issuer } = await setup();
    const { encodeTokenChallenge } = await import('../src/attestation.js');

    for (const originInfo of [
      'merchant.example', // conformant: a server name
      'merchant.example:8443', // conformant: server name with a port
      'https://merchant.example', // non-conformant, but seen in the wild
    ]) {
      const perOrigin = await sha256(
        encodeTokenChallenge({ issuerName: fixture.issuerName, originInfo }),
      );
      const minted = await fixture.mint({ challengeDigestOverride: perOrigin });
      const parsed = parseToken(minted.raw);
      assert.ok(typeof parsed !== 'string');

      const result = await challengeDigestMatches({
        issuerName: issuer.issuerName,
        presented: parsed.challengeDigest,
      });
      assert.equal(
        result.matched,
        false,
        `origin_info ${originInfo} must not match`,
      );
    }
  });
});

describe('key rotation', () => {
  it('refreshes on an unknown key id, so a new key is picked up without restart', async () => {
    const { fixture, issuer } = await setup(1);
    await issuer.advertisableKeys();

    await fixture.addKey();
    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');

    const key = await issuer.resolveKey(parsed.tokenKeyId);
    assert.ok(key, 'an unknown key id should trigger a refresh');
  });

  it('stops trusting a retired key by default', async () => {
    const { fixture, issuer } = await setup(2);
    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    fixture.retireKey(1);
    await issuer.refresh({ force: true });
    assert.equal(
      await issuer.resolveKey(parsed.tokenKeyId),
      undefined,
      'a key the issuer no longer advertises must not verify by default',
    );
  });

  it('honours a grace window when one is configured', async () => {
    const fixture = await LinkFixture.create('https://api.link.com', 2);
    let clock = 1_000_000;
    const issuer = new LinkIssuer({
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 0,
      retiredKeyGraceSeconds: 3600,
      now: () => clock,
    });
    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(await issuer.resolveKey(parsed.tokenKeyId));

    fixture.retireKey(1);
    clock += 60;
    await issuer.refresh({ force: true });
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'inside the grace window the retired key still verifies',
    );

    clock += 7200;
    await issuer.refresh({ force: true });
    assert.equal(
      await issuer.resolveKey(parsed.tokenKeyId),
      undefined,
      'past the grace window it must not',
    );
  });

  it('does not advertise a staged key, but still verifies tokens minted under it', async () => {
    // RFC 9578 section 8.3 makes `not-before` a client-side SHOULD about
    // issuance, and says in the same breath that an origin may attempt any key in
    // the list when verifying, precisely because client clock skew is expected to
    // put tokens either side of the boundary. So the field belongs on what we
    // advertise, not on what we accept. Enforcing it as a verification gate
    // hard-rejects legitimate traffic at exactly the moment of a scheduled
    // rotation, which is the opposite of what staging a key is for.
    const fixture = await LinkFixture.create('https://api.link.com', 1);
    const clock = 1_000_000;
    await fixture.addKey({ notBefore: clock + 3600 });
    const issuer = new LinkIssuer({
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 0,
      now: () => clock,
    });

    const advertised = await issuer.advertisableKeys();
    assert.equal(advertised.length, 1, 'a staged key must not be advertised');

    const minted = await fixture.mint({ keyIndex: 1 });
    const parsed = parseToken(minted.raw);
    assert.ok(typeof parsed !== 'string');
    assert.ok(
      await issuer.resolveKey(parsed.tokenKeyId),
      'a token already minted under a staged key must still verify',
    );
  });
});

describe('trust anchor', () => {
  it('refuses metadata that declares a different issuer', async () => {
    const fixture = await LinkFixture.create('https://evil.example', 1);
    const issuer = new LinkIssuer({
      issuer: 'https://api.link.com',
      fetchImpl: fixture.fetchImpl(),
      minRefreshSeconds: 0,
    });
    await assert.rejects(() => issuer.refresh({ force: true }));
  });
});

describe('bytes', () => {
  it('base64url round-trips at every length mod 3', async () => {
    for (let n = 0; n < 40; n++) {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
      assert.deepEqual(fromBase64(toBase64url(bytes)), bytes, `length ${n}`);
    }
  });
});
