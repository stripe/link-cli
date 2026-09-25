import { describe, expect, it, vi } from 'vitest';
import {
  authenticationSchemes,
  createIdentityChallengeHeaders,
  type IdentityProvider,
  parseIdentityChallenge,
  stripIdentityCredentialHeaders,
} from '../challenges';

function challengeResponse(
  overrides: Record<string, unknown> = {},
  authenticate = 'PrivateToken challenge="stable,with-comma", token-key="link-key", Identity-Presentation',
): Response {
  return new Response(
    JSON.stringify({
      type: 'urn:aap:claims-required',
      aud: 'https://merchant.example',
      nonce: 'challenge-nonce',
      claims: ['email'],
      formats: ['dc+sd-jwt'],
      trusted_issuers: ['https://api.link.com'],
      ...overrides,
    }),
    {
      status: 401,
      headers: {
        'content-type': 'application/problem+json',
        'www-authenticate': authenticate,
      },
    },
  );
}

function identityProvider(): IdentityProvider {
  return {
    takeAttestation: vi.fn().mockResolvedValue({
      authorization: 'PrivateToken token="attestation"',
    }),
    presentIdentityCredential: vi.fn().mockResolvedValue({
      presentation: 'presentation',
    }),
  };
}

const disclosureAuthorization = {
  audience: 'https://merchant.example',
  claims: ['email'],
};

describe('authenticationSchemes', () => {
  it('distinguishes schemes from parameters and ignores quoted commas', () => {
    expect(
      authenticationSchemes(
        'PrivateToken challenge="one,two", token-key="key", Identity-Presentation, Basic realm="example"',
      ),
    ).toEqual(new Set(['privatetoken', 'identity-presentation', 'basic']));
  });
});

describe('parseIdentityChallenge', () => {
  it('returns a valid challenge for the exact request origin', async () => {
    await expect(
      parseIdentityChallenge(
        challengeResponse(),
        'https://merchant.example/contribute?campaign=1',
      ),
    ).resolves.toEqual({
      aud: 'https://merchant.example',
      nonce: 'challenge-nonce',
      claims: ['email'],
    });
  });

  it('rejects an audience other than the request origin', async () => {
    await expect(
      parseIdentityChallenge(
        challengeResponse({ aud: 'https://attacker.example' }),
        'https://merchant.example/contribute',
      ),
    ).rejects.toThrow(/audience does not match/);
  });

  it('requires Link to be the only trusted issuer', async () => {
    await expect(
      parseIdentityChallenge(
        challengeResponse({
          trusted_issuers: ['https://api.link.com', 'https://issuer.example'],
        }),
        'https://merchant.example/contribute',
      ),
    ).rejects.toThrow(/challenge body is invalid/);
  });

  it('rejects the wrong content type and malformed problem bodies', async () => {
    const wrongType = challengeResponse();
    wrongType.headers.set('content-type', 'application/json');
    await expect(
      parseIdentityChallenge(wrongType, 'https://merchant.example'),
    ).rejects.toThrow(/application\/problem\+json/);

    const malformed = new Response('{', {
      status: 401,
      headers: { 'content-type': 'application/problem+json' },
    });
    await expect(
      parseIdentityChallenge(malformed, 'https://merchant.example'),
    ).rejects.toThrow(/body is invalid/);
  });
});

describe('createIdentityChallengeHeaders', () => {
  it('presents claims before consuming an attestation', async () => {
    const calls: string[] = [];
    const provider: IdentityProvider = {
      presentIdentityCredential: vi.fn().mockImplementation(async (input) => {
        calls.push('presentation');
        expect(input).toEqual({
          aud: 'https://merchant.example',
          nonce: 'challenge-nonce',
          claim: ['email'],
        });
        return { presentation: 'presentation' };
      }),
      takeAttestation: vi.fn().mockImplementation(async () => {
        calls.push('attestation');
        return { authorization: 'PrivateToken token="attestation"' };
      }),
    };

    const result = await createIdentityChallengeHeaders({
      response: challengeResponse(),
      requestUrl: 'https://merchant.example/contribute',
      requestHeaders: { 'x-request': 'value' },
      identityProvider: provider,
      disclosureAuthorization,
    });

    expect(calls).toEqual(['presentation', 'attestation']);
    expect(result?.ephemeralHeaderNames).toEqual([
      'identity-presentation',
      'authorization',
    ]);
    expect(result?.headers.get('identity-presentation')).toBe('presentation');
    expect(result?.headers.get('authorization')).toMatch(/^PrivateToken /);
    expect(result?.headers.get('x-request')).toBe('value');
  });

  it('does not consume an attestation when presentation fails', async () => {
    const provider = identityProvider();
    vi.mocked(provider.presentIdentityCredential).mockRejectedValue(
      new Error('no credential'),
    );

    await expect(
      createIdentityChallengeHeaders({
        response: challengeResponse(),
        requestUrl: 'https://merchant.example/contribute',
        requestHeaders: {},
        identityProvider: provider,
        disclosureAuthorization,
      }),
    ).rejects.toThrow('no credential');
    expect(provider.takeAttestation).not.toHaveBeenCalled();
  });

  it('requires caller authorization before disclosing any claims', async () => {
    const provider = identityProvider();

    await expect(
      createIdentityChallengeHeaders({
        response: challengeResponse(),
        requestUrl: 'https://merchant.example/contribute',
        requestHeaders: {},
        identityProvider: provider,
      }),
    ).rejects.toThrow(/requires explicit claim authorization/);
    expect(provider.presentIdentityCredential).not.toHaveBeenCalled();
    expect(provider.takeAttestation).not.toHaveBeenCalled();
  });

  it('rejects claims added after the caller authorized disclosure', async () => {
    const provider = identityProvider();

    await expect(
      createIdentityChallengeHeaders({
        response: challengeResponse({ claims: ['email', 'phone'] }),
        requestUrl: 'https://merchant.example/contribute',
        requestHeaders: {},
        identityProvider: provider,
        disclosureAuthorization,
      }),
    ).rejects.toThrow(/claims that were not explicitly authorized/);
    expect(provider.presentIdentityCredential).not.toHaveBeenCalled();
    expect(provider.takeAttestation).not.toHaveBeenCalled();
  });

  it('scopes claim authorization to one audience', async () => {
    const provider = identityProvider();

    await expect(
      createIdentityChallengeHeaders({
        response: challengeResponse(),
        requestUrl: 'https://merchant.example/contribute',
        requestHeaders: {},
        identityProvider: provider,
        disclosureAuthorization: {
          audience: 'https://other.example',
          claims: ['email'],
        },
      }),
    ).rejects.toThrow(/audience was not explicitly authorized/);
    expect(provider.presentIdentityCredential).not.toHaveBeenCalled();
    expect(provider.takeAttestation).not.toHaveBeenCalled();
  });

  it('ignores responses without a supported identity challenge', async () => {
    const provider = identityProvider();
    await expect(
      createIdentityChallengeHeaders({
        response: new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Basic realm="merchant"' },
        }),
        requestUrl: 'https://merchant.example',
        requestHeaders: {},
        identityProvider: provider,
      }),
    ).resolves.toBeNull();
    expect(provider.takeAttestation).not.toHaveBeenCalled();
  });
});

describe('stripIdentityCredentialHeaders', () => {
  it('removes only generated identity credentials', () => {
    const stripped = stripIdentityCredentialHeaders({
      authorization: 'PrivateToken token="attestation"',
      'identity-presentation': 'presentation',
      'x-request': 'value',
    });
    expect(stripped.hadIdentityCredentials).toBe(true);
    expect([...stripped.headers]).toEqual([['x-request', 'value']]);
  });

  it('preserves non-PrivateToken authorization', () => {
    const stripped = stripIdentityCredentialHeaders({
      authorization: 'Bearer caller-token',
    });
    expect(stripped.hadIdentityCredentials).toBe(false);
    expect(stripped.headers.get('authorization')).toBe('Bearer caller-token');
  });
});
