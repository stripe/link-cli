# Integrating Agent Identity

Use `@stripe/agent-identity` to verify Link bearer Agent Attestation Tokens (AATs) and SD-JWT-VC identity presentations. Read [README.md](README.md) for the API, integration examples, and limitations.

## Scope

The SDK checks credentials. It does not sign or verify HTTP requests, resolve agent key directories, or process Web Bot Auth (WBA) headers. Do not add HTTP Message Signature requirements, raw body parsing, or `Content-Digest` validation to an integration with this SDK.

A bearer AAT proves issuance by Link. It does not identify the presenter or bind the token to your service or a particular request. Identity presentations require a holder-signed Key Binding JWT, audience, expiry, required-claims checks, and equality with the caller-provided expected nonce. These checks bind disclosures to the intended audience and expected interaction nonce.

## Integration

1. Install with `npm install @stripe/agent-identity`. The package supports Node 22+, ESM and CommonJS. It uses Node built-ins and `jose`; runtimes without the required Node APIs are unsupported. For local SDK development, follow [build and install from source](README.md#build-and-install-from-source), which requires Node 24+ and pnpm.
2. Create one `LinkVerifier` per process. Set `origin` from the service's configuration; it is the audience for identity claims. Use an explicit HTTP origin such as `http://localhost:3000` for local servers; bare authorities default to HTTPS.
3. Extract the `Authorization` or `Identity-Presentation` field value and pass the string directly. Reject duplicate credential fields if your framework would otherwise discard them. In Node or Express, use `req.headersDistinct`; the SDK cannot recover fields your framework dropped.
4. Inspect `result.valid`, or use the `OrThrow` variants and handle `VerificationError`. The result object itself is truthy even when verification fails.
5. Use `isRejection` to distinguish credential rejection (usually 401) from `issuer_unavailable` (usually 503). Handle errors from challenge builders and optional `warm()` separately; they throw on failure.
6. Request identity claims only when the application needs them. Associate the challenge nonce with the application interaction. Pass that nonce and explicit `requiredClaims` when verifying the presentation.
7. Apply the application's authorization and session policy after credential verification. Do not use `tokenKeyId` as a user or agent identity: it identifies an issuer signing key shared by many tokens.

```ts
import { LinkVerifier } from '@stripe/agent-identity';

const verifier = new LinkVerifier({ origin: 'https://shop.example' });
const attestation = await verifier.verifyAttestation(request.headers.get('Authorization'));

const claims = await verifier.verifyClaims(request.headers.get('Identity-Presentation'), {
  nonce: nonceFromSession,
  requiredClaims: ['email'],
});
```

Keep normal framework body parsing and size limits. Verification does not consume or authenticate the request body. Serve credential-bearing endpoints over HTTPS; the SDK receives credential strings and cannot check transport security.

## Claims and state

`claimsChallenge()` returns a nonce and advertised `expiresAt` value without storing either. The application associates the nonce with an interaction, enforces expiration, and atomically consumes or completes the interaction when its policy requires single use. `verifyClaims()` only checks that the holder-signed nonce equals the expected nonce supplied by the caller. Verification does not mutate application state, and the same valid presentation can verify again when passed the same expected nonce.

The `holderKeyThumbprint` returned by claims verification identifies the key in the credential's `cnf.jwk`. It does not authenticate the HTTP request or tie a separate anonymous AAT to that holder.

## Tests

Use the shipped `LinkFixture` and `CredentialFixture`. They use real cryptography and expose controls for invalid signatures, wrong audiences, expired credentials, and unsupported challenge digests.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkVerifier } from '@stripe/agent-identity';
import { LinkFixture } from '@stripe/agent-identity/testing';

test('verifies Link tokens without a request signature', async () => {
  const link = await LinkFixture.create();
  const verifier = new LinkVerifier({ origin: 'shop.example', fetchImpl: link.fetchImpl() });
  const token = await link.mint();
  assert.equal((await verifier.verifyAttestation(token.authorization)).valid, true);
  const forged = await link.mint({ corruptAuthenticator: true });
  assert.equal((await verifier.verifyAttestation(forged.authorization)).valid, false);
});
```

For credential tests, use `combineFetch` to serve Link metadata and credential JWKS and call `clearJwksCache()` between fixtures using different signing keys at the same issuer URL. After installing workspace dependencies, run `pnpm build`, `pnpm typecheck`, and `pnpm test` from `packages/agent-identity`. Follow the [development instructions](README.md#development) for the HTTP example, package installation, and documentation checks that also run in CI.

After changing issuance formats or wallet commands, also run `node --test test/wallet.test.mjs` from this package after building the wallet client SDK and CLI. Follow the [development instructions](README.md#development). This separate CI check uses the built wallet, a local issuer, and temporary storage to test issuance and presentation against the verifier and HTTP example.

## Limits to preserve in documentation

- AAT single use is not enforced. A bearer token can be replayed wherever it is trusted. Its lifetime is tied to issuer key acceptance, not challenge `max-age`.
- Key-bound AATs are unsupported and must fail with `challenge_mismatch`; this SDK does not establish possession of an agent signing key.
- Credential verification does not authorize an HTTP operation or authenticate its method, URL, or body. The application owns authorization and replay policy.
- Credential signing keys are cached process-wide for one hour; `issuerOptions.maxKeyAgeSeconds` controls only token keys.

AAT and identity-presentation double-spend detection and replay prevention belong to adopters and must be implemented in their own stack if needed. The SDK provides no spent-token or nonce store and no replay enforcement.

## Package maintenance

Keep the verifier independent of the wallet client: no runtime dependency on `@stripe/link-sdk` or `@stripe/link-cli`. Preserve ESM and CommonJS exports, the `/testing` entry point, Node 22 support for consumers, and the library declaration typecheck. Use Node built-ins and `jose` for standard byte and cryptography operations; retain identity-specific validation. Keep `jose` imports dynamic so the CommonJS build works on Node 22.0. Workspace development uses Node 24+. Examples use `example/`, matching the other integrations. Keep guidance in READMEs and examples; there is no documentation website. Preserve wire identifiers and published issuer paths when updating product names.
