/**
 * Test fixtures, shipped as part of the package.
 *
 * Verifying an AAT means being handed bytes produced by machinery you do not
 * run: Link's blind-RSA issuer and a wallet's SD-JWT-VC holder binding. Testing your own 401 handling therefore means minting those
 * bytes, which requires correct cryptographic operations and wire encoding.
 *
 * So these are exported rather than kept private to this repo's test suite.
 * They are real crypto throughout. Each one also exposes the knobs needed to
 * produce deliberately *invalid* input, because the cases worth testing at a
 * front door are the rejections.
 *
 * These are for tests. They generate keys on every call and hold private keys in
 * memory; nothing here belongs in a production path.
 */

export { combineFetch } from './combine-fetch.js';
export type {
  CredentialFixtureOptions,
  PresentOptions,
} from './credential-fixture.js';

export { CredentialFixture } from './credential-fixture.js';
export type { MintedToken, MintOptions } from './link-fixture.js';
export { LinkFixture } from './link-fixture.js';
