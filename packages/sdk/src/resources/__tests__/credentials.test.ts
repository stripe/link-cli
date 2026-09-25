import { describe, expect, it, vi } from 'vitest';
import { LinkResponseError } from '@/errors';
import { IdentityCredentialsResource } from '@/resources/identity-credentials';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PUBLIC_JWK = {
  kty: 'OKP' as const,
  crv: 'Ed25519' as const,
  x: 'public-key',
};

describe('IdentityCredentialsResource', () => {
  it('issues through the discovered credential endpoint', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://api.link.com/.well-known/aap-issuer') {
          expect(init).toMatchObject({
            method: 'GET',
            redirect: 'manual',
          });
          return jsonResponse({
            issuer: 'https://api.link.com',
            credential_endpoint: 'https://api.link.com/credential',
          });
        }
        expect(url).toBe('https://api.link.com/credential');
        expect(init?.redirect).toBe('manual');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer access-token',
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          cnf: { jwk: PUBLIC_JWK },
        });
        return jsonResponse({
          credential: 'issuer-jwt~',
          issuer: 'https://api.link.com',
          expires_at: '2026-08-25T00:00:00Z',
        });
      },
    );
    const resource = new IdentityCredentialsResource({
      apiBaseUrl: 'https://attacker.example',
      accessToken: 'access-token',
      fetch: fetchMock,
    });

    await expect(
      resource.issue({ cnf: { jwk: PUBLIC_JWK } }),
    ).resolves.toMatchObject({
      credential: 'issuer-jwt~',
      issuer: 'https://api.link.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects metadata for a different issuer before authentication', async () => {
    const getAccessToken = vi.fn(async () => 'secret');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          issuer: 'https://attacker.example',
          credential_endpoint: 'https://api.link.com/credential',
        }),
    );
    const resource = new IdentityCredentialsResource({
      getAccessToken,
      fetch: fetchMock,
    });

    await expect(
      resource.issue({ cnf: { jwk: PUBLIC_JWK } }),
    ).rejects.toBeInstanceOf(LinkResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an off-origin credential endpoint before authentication', async () => {
    const getAccessToken = vi.fn(async () => 'secret');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          issuer: 'https://api.link.com',
          credential_endpoint: 'https://attacker.example/credential',
        }),
    );
    const resource = new IdentityCredentialsResource({
      getAccessToken,
      fetch: fetchMock,
    });

    await expect(resource.issue({ cnf: { jwk: PUBLIC_JWK } })).rejects.toThrow(
      'credential_endpoint must be an HTTPS URL',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('refuses issuer metadata redirects', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('', {
          status: 302,
          headers: { Location: 'https://attacker.example/metadata' },
        }),
    );
    const resource = new IdentityCredentialsResource({
      accessToken: 'access-token',
      fetch: fetchMock,
    });

    await expect(resource.issue({ cnf: { jwk: PUBLIC_JWK } })).rejects.toThrow(
      'Refused redirect',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps malformed credential responses in LinkResponseError', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) =>
        String(input).endsWith('/.well-known/aap-issuer')
          ? jsonResponse({
              issuer: 'https://api.link.com',
              credential_endpoint: 'https://api.link.com/credential',
            })
          : jsonResponse({ credential: 42 }),
    );
    const resource = new IdentityCredentialsResource({
      accessToken: 'access-token',
      fetch: fetchMock,
    });

    await expect(
      resource.issue({ cnf: { jwk: PUBLIC_JWK } }),
    ).rejects.toBeInstanceOf(LinkResponseError);
  });

  it('rejects a credential response from a different issuer', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) =>
        String(input).endsWith('/.well-known/aap-issuer')
          ? jsonResponse({
              issuer: 'https://api.link.com',
              credential_endpoint: 'https://api.link.com/credential',
            })
          : jsonResponse({
              credential: 'issuer-jwt~',
              issuer: 'https://attacker.example',
              expires_at: '2026-08-25T00:00:00Z',
            }),
    );
    const resource = new IdentityCredentialsResource({
      accessToken: 'access-token',
      fetch: fetchMock,
    });

    await expect(
      resource.issue({ cnf: { jwk: PUBLIC_JWK } }),
    ).rejects.toBeInstanceOf(LinkResponseError);
  });

  it('sends only public JWK members', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/.well-known/aap-issuer')) {
          return jsonResponse({
            issuer: 'https://api.link.com',
            credential_endpoint: 'https://api.link.com/credential',
          });
        }
        expect(JSON.parse(String(init?.body))).toEqual({
          cnf: { jwk: PUBLIC_JWK },
        });
        return jsonResponse({
          credential: 'issuer-jwt~',
          issuer: 'https://api.link.com',
          expires_at: '2026-08-25T00:00:00Z',
        });
      },
    );
    const resource = new IdentityCredentialsResource({
      accessToken: 'access-token',
      fetch: fetchMock,
    });

    await expect(
      resource.issue({
        cnf: { jwk: { ...PUBLIC_JWK, d: 'private' } as never },
      }),
    ).resolves.toMatchObject({ issuer: 'https://api.link.com' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes LinkOptions authentication after a credential 401', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) =>
        String(input).endsWith('/.well-known/aap-issuer')
          ? jsonResponse({
              issuer: 'https://api.link.com',
              credential_endpoint: 'https://api.link.com/credential',
            })
          : jsonResponse({ error: 'unauthorized' }, 401),
    );
    const getAccessToken = vi.fn(
      ({ forceRefresh }: { forceRefresh?: boolean } = {}) =>
        forceRefresh ? 'refreshed-token' : 'initial-token',
    );
    const resource = new IdentityCredentialsResource({
      getAccessToken,
      fetch: fetchMock,
    });

    await expect(resource.issue({ cnf: { jwk: PUBLIC_JWK } })).rejects.toThrow(
      'Failed to issue identity credential (401)',
    );
    expect(getAccessToken).toHaveBeenNthCalledWith(1);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: 'Bearer initial-token',
      }),
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: 'Bearer refreshed-token',
      }),
    });
  });
});
