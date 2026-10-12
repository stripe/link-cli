import assert from 'node:assert/strict';
import { LinkVerifier } from '@stripe/agent-identity';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '@stripe/agent-identity/testing';

// This fixture serves local issuer metadata and uses real cryptographic keys.
const link = await LinkFixture.create();
const credential = await CredentialFixture.create({
  issuerUrl: link.issuer,
  claims: { email: 'alex@example.com', email_verified: true },
});
const verifier = new LinkVerifier({
  origin: 'https://shop.example',
  fetchImpl: combineFetch(link.fetchImpl(), credential.fetchImpl()),
});

const token = await link.mint();
const accepted = await verifier.verifyAttestation(token.authorization);
assert.equal(accepted.valid, true);

const forged = await link.mint({ corruptAuthenticator: true });
const rejected = await verifier.verifyAttestation(forged.authorization);
assert.equal(rejected.valid, false);

console.log('Valid Link attestation: accepted');
console.log('Forged attestation: rejected');

// The application keeps the expected nonce; the holder signs selected claims.
const requiredClaims = ['email', 'email_verified'];
const challenge = await verifier.claimsChallenge({ claims: requiredClaims });
const presentation = await credential.present({
  aud: challenge.body.aud,
  nonce: challenge.nonce,
  disclose: requiredClaims,
});
const options = { nonce: challenge.nonce, requiredClaims };
const claims = await verifier.verifyClaims(presentation, options);
assert.equal(claims.valid, true);
// Required-claim checks enforce presence. The application checks their values.
assert.equal(typeof claims.claims.email, 'string');
assert.equal(claims.claims.email_verified, true);
console.log('Verified email presentation: accepted');

const wrongAudience = await credential.present({
  aud: 'https://another.example',
  nonce: challenge.nonce,
  disclose: requiredClaims,
});
assert.equal(
  (await verifier.verifyClaims(wrongAudience, options)).valid,
  false,
);
console.log('Wrong-audience presentation: rejected');

// This example only verifies proofs. See step-up/ for application-owned state,
// interaction expiry, sessions, and atomic registration with safe retries.
