import { describe, expect, it } from 'vitest';
import { authorizationHeader, exportAttestationTokens } from '../export';

describe('attestation export contract', () => {
  it('preserves token bytes and documents the PrivateToken header', () => {
    const token = Buffer.from('raw-token-bytes').toString('base64url');
    const exported = exportAttestationTokens({
      tokens: [token],
      issuer: 'https://api.link.com',
      token_key_id: 'kid',
      count: 1,
    });

    expect(exported.version).toBe(1);
    expect(exported.tokens[0]?.token).toBe(token);
    expect(exported.tokens[0]?.authorization).toBe(authorizationHeader(token));
    expect(exported.tokens[0]?.authorization).toMatch(
      /^PrivateToken token="[A-Za-z0-9_-]+={0,2}"$/,
    );
  });
});
