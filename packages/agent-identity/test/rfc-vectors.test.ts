/** RFC 7638 Section 3.1: independent vectors for credential holder thumbprints. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { type Jwk, jwkThumbprint } from '../src/internal/crypto.js';

describe('RFC 7638 Section 3.1, JWK thumbprint', () => {
  /** The example RSA key from Section 3.1, `kid` 2011-04-29. */
  const RFC7638_JWK: Jwk = {
    kty: 'RSA',
    n:
      '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc' +
      '_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQ' +
      'R0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bF' +
      'TWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
    e: 'AQAB',
    alg: 'RS256',
    kid: '2011-04-29',
  };

  /** The base64url SHA-256 thumbprint the RFC states for that key. */
  const RFC7638_EXPECTED = 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs';

  it('computes the published thumbprint', async () => {
    assert.equal(await jwkThumbprint(RFC7638_JWK), RFC7638_EXPECTED);
  });

  it('ignores members outside the required set, as the RFC requires', async () => {
    // `alg` and `kid` are present in the RFC's own example and must not affect the
    // result. Getting this wrong is the classic thumbprint bug.
    const withExtras: Jwk = { ...RFC7638_JWK, use: 'sig', key_ops: ['verify'] };
    assert.equal(await jwkThumbprint(withExtras), RFC7638_EXPECTED);
  });
});
