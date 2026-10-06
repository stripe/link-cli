import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearJwksCache, LinkVerifier } from '../src/index.js';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '../src/testing/index.js';

// All credentials and issuer responses in these regressions are local fixtures.
test('concurrent first verifications await the same issuer discovery', async () => {
  const link = await LinkFixture.create();
  const token = await link.mint();
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const verifier = new LinkVerifier({
    origin: 'https://service.example',
    fetchImpl: async (input, init) => {
      calls++;
      await pending;
      return link.fetchImpl()(input, init);
    },
  });
  const results = Promise.all(
    Array.from({ length: 40 }, () =>
      verifier.verifyAttestation(token.authorization),
    ),
  );
  release();
  for (const result of await results) assert.equal(result.valid, true);
  assert.equal(calls, 2, 'one metadata fetch and one token-key fetch');
});

test('a key past its freshness limit stays rejected throughout issuer failure backoff', async () => {
  const link = await LinkFixture.create();
  const token = await link.mint();
  let now = 1_000_000;
  let unavailable = false;
  let calls = 0;
  const verifier = new LinkVerifier({
    origin: 'https://service.example',
    now: () => now,
    issuerOptions: { maxKeyAgeSeconds: 2 },
    fetchImpl: async (input, init) => {
      calls++;
      return unavailable
        ? new Response('unavailable', { status: 503 })
        : link.fetchImpl()(input, init);
    },
  });
  assert.equal(
    (await verifier.verifyAttestation(token.authorization)).valid,
    true,
  );
  now += 3;
  unavailable = true;
  for (let i = 0; i < 10; i++) {
    const result = await verifier.verifyAttestation(token.authorization);
    assert.equal(result.valid, false);
    if (!result.valid)
      assert.equal(result.failures[0]?.code, 'issuer_unavailable');
    now++;
  }
  assert.equal(calls, 3, 'outage backoff must prevent repeated fetches');
  unavailable = false;
  now += 30;
  assert.equal(
    (await verifier.verifyAttestation(token.authorization)).valid,
    true,
  );
});

test('holder presentation signing time must be a number', async () => {
  clearJwksCache();
  const link = await LinkFixture.create();
  const credential = await CredentialFixture.create({
    issuerUrl: link.issuer,
    claims: { email: 'person@example.com' },
  });
  const verifier = new LinkVerifier({
    origin: 'https://service.example',
    fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()),
  });
  const challenge = await verifier.claimsChallenge({ claims: ['email'] });
  const options = { nonce: challenge.nonce, requiredClaims: ['email'] };
  for (const iat of [
    'not-a-timestamp',
    {},
    [],
    true,
    String(Math.floor(Date.now() / 1000)),
  ]) {
    const presentation = await credential.present({
      aud: challenge.body.aud,
      nonce: challenge.nonce,
      disclose: ['email'],
      iat: iat as unknown as number,
    });
    const result = await verifier.verifyClaims(presentation, options);
    assert.equal(
      result.valid,
      false,
      `non-numeric signing time: ${JSON.stringify(iat)}`,
    );
    if (!result.valid)
      assert.equal(result.failures[0]?.code, 'invalid_claims_presentation');
  }
  const valid = await credential.present({
    aud: challenge.body.aud,
    nonce: challenge.nonce,
    disclose: ['email'],
  });
  assert.equal((await verifier.verifyClaims(valid, options)).valid, true);
});

test('required claims must be disclosed own properties', async () => {
  clearJwksCache();
  const link = await LinkFixture.create();
  const credential = await CredentialFixture.create({
    issuerUrl: link.issuer,
    claims: {},
  });
  const verifier = new LinkVerifier({
    origin: 'https://service.example',
    fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()),
  });
  const presentation = await credential.present({
    aud: 'https://service.example',
    nonce: 'interaction',
    disclose: [],
  });
  const result = await verifier.verifyClaims(presentation, {
    nonce: 'interaction',
    requiredClaims: ['toString'],
  });
  assert.equal(result.valid, false);
});

test('a disclosed property named __proto__ remains a data property', async () => {
  clearJwksCache();
  const link = await LinkFixture.create();
  const credential = await CredentialFixture.create({
    issuerUrl: link.issuer,
    claims: {},
    extraDisclosures: [['salt', '__proto__', { email: 'person@example.com' }]],
  });
  const verifier = new LinkVerifier({
    origin: 'https://service.example',
    fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()),
  });
  const presentation = await credential.present({
    aud: 'https://service.example',
    nonce: 'interaction',
    disclose: [],
  });
  const result = await verifier.verifyClaims(presentation, {
    nonce: 'interaction',
    requiredClaims: ['__proto__'],
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(Object.getPrototypeOf(result.claims), Object.prototype);
    assert.equal(Object.hasOwn(result.claims, '__proto__'), true);
    assert.equal(result.claims.email, undefined);
  }
  const missing = await verifier.verifyClaims(presentation, {
    nonce: 'interaction',
    requiredClaims: ['email'],
  });
  assert.equal(missing.valid, false);
});

test('explicit retired-key grace remains usable after a successful directory revalidation', async () => {
  const link = await LinkFixture.create('https://api.link.com', 2);
  const token = await link.mint({ keyIndex: 1 });
  let now = 1_000_000;
  const verifier = new LinkVerifier({
    origin: 'https://service.example',
    fetchImpl: link.fetchImpl(),
    now: () => now,
    issuerOptions: { maxKeyAgeSeconds: 2, retiredKeyGraceSeconds: 60 },
  });
  assert.equal(
    (await verifier.verifyAttestation(token.authorization)).valid,
    true,
  );
  link.retireKey(1);
  now += 10;
  assert.equal(
    (await verifier.verifyAttestation(token.authorization)).valid,
    true,
  );
  now += 60;
  assert.equal(
    (await verifier.verifyAttestation(token.authorization)).valid,
    false,
  );
});
