# Test an Agent Identity integration

See the [package README](../README.md) for setup.

The SDK ships `LinkFixture` and `CredentialFixture` under `@stripe/agent-identity/testing`. They use real cryptographic signatures and local issuer responses, so tests can exercise the full verifier without contacting Link.

## Check bearer tokens

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkVerifier } from '@stripe/agent-identity';
import { LinkFixture } from '@stripe/agent-identity/testing';

test('accepts an issued token and rejects a forged token', async () => {
  const link = await LinkFixture.create();
  const verifier = new LinkVerifier({
    origin: 'https://shop.example',
    fetchImpl: link.fetchImpl(),
  });

  const token = await link.mint();
  assert.equal((await verifier.verifyAttestation(token.authorization)).valid, true);

  const forged = await link.mint({ corruptAuthenticator: true });
  const result = await verifier.verifyAttestation(forged.authorization);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.failures[0]?.code, 'invalid_private_token');
  }
});
```

The fixture signs a token authenticator directly. It exercises redemption verification, not the blinding and unblinding performed during issuance.

Repository maintainers can also run the [wallet integration test](../README.md#development). It uses the built wallet to blind requests, unblind real issuer signatures, save and pop tokens, and sign presentations with its persisted holder key. It checks selective disclosure, audience and nonce rejection, and the executable event-registration example. The issuer is local and the wallet uses temporary storage; no Link account is required.

## Check identity claims

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkVerifier, clearJwksCache } from '@stripe/agent-identity';
import {
  LinkFixture, CredentialFixture, combineFetch,
} from '@stripe/agent-identity/testing';

test('verifies a presentation without enforcing replay policy', async () => {
  clearJwksCache();
  const link = await LinkFixture.create();
  const credential = await CredentialFixture.create({
    issuerUrl: link.issuer,
    claims: { email: 'ada@example.com' },
  });
  const verifier = new LinkVerifier({
    origin: 'https://shop.example',
    fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()),
  });
  const challenge = await verifier.claimsChallenge({ claims: ['email'] });
  const presentation = await credential.present({
    aud: challenge.body.aud,
    nonce: challenge.nonce,
    disclose: ['email'],
  });
  const options = { nonce: challenge.nonce, requiredClaims: ['email'] };

  assert.equal((await verifier.verifyClaims(presentation, options)).valid, true);
  assert.equal((await verifier.verifyClaims(presentation, options)).valid, true);
});
```

Credential signing keys are cached process-wide by issuer JWKS URL. Call `clearJwksCache()` between tests that create different keys for the same issuer. Avoid running those fixture sets concurrently in the same process.

Test application replay policy separately. If an interaction may succeed only once, cover concurrent retries against the application state that atomically completes the interaction. Do not expect the SDK to make one verification fail.

## Test your HTTP boundary

Use a real HTTP listener in addition to SDK-level tests. The framework controls repeated headers, request bodies, and response formatting.

| Case | Expected behavior |
| --- | --- |
| Missing credential | `401` with the appropriate challenge |
| Concurrent first requests with valid attestations | All share issuer discovery; no false credential rejections |
| Stale issuer keys during outage backoff | `issuer_unavailable`; never accept keys beyond configured freshness |
| Nonnumeric presentation signing time or inherited claim names | Rejection; freshness and required claims use validated values |
| Forged token or wrong audience | Rejection before the protected operation |
| Missing required claims | Rejection without mutating application state |
| Two SDK verifications with the same valid presentation and expected nonce | Both succeed; replay policy belongs to the application |
| Two application requests for a single-use interaction | Application state permits exactly one operation |
| Different sessions | A presentation cannot answer another session's expected nonce |
| Duplicate credential fields | Rejection before the framework loses duplicate information |
| Invalid or oversized JSON | Your framework's normal body validation applies |
| Issuer or application state unavailable | `503`; no protected operation |

## Control time

The `now` option returns Unix time in seconds. Fixture credential expiry and presentation `iat` must agree with your injected time. Your application controls the clock used for interaction expiry.

The following excerpt assumes an existing `fetchImpl` and an `assert` import:

```ts
let now = Math.floor(Date.now() / 1000);
const verifier = new LinkVerifier({
  origin: 'https://shop.example',
  fetchImpl,
  now: () => now,
});

const challenge = await verifier.claimsChallenge({
  claims: ['email'],
  nonceTtlSeconds: 2,
});
now += 2;
assert.equal(challenge.expiresAt, now);
```

`nonceTtlSeconds` controls the returned `expiresAt` metadata. The SDK does not enforce that expiry; test your application's expiration behavior where it stores the interaction.
