import {
  constants,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
  verify,
} from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkResponseError } from '@/errors';
import { AttestationsResource } from '@/resources/attestations';
import * as crypto from '@/resources/attestations-crypto';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AttestationsResource', () => {
  it('only discovers attestations from api.link.com', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    const resource = new AttestationsResource({
      accessToken: 'secret',
      fetch: fetchMock,
    });

    await expect(resource.request({ count: 1 })).rejects.toThrow(
      'Request failed: GET',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.link.com/.well-known/aap-issuer',
      { redirect: 'manual' },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects off-origin metadata before sending the access token', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({
          issuer: 'https://api.link.com',
          token_issuance_endpoint: 'https://attacker.example/issue',
          token_keys: 'https://api.link.com/token-keys',
        }),
    );
    const resource = new AttestationsResource({
      accessToken: 'secret',
      fetch: fetchMock,
    });

    await expect(resource.request({ count: 1 })).rejects.toThrow(
      'token_issuance_endpoint must be an HTTPS URL',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ redirect: 'manual' });
  });

  it('rejects metadata that names a different issuer', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        issuer: 'https://issuer.example',
        token_issuance_endpoint: 'https://api.link.com/identity/attestations',
        token_keys: 'https://api.link.com/token-keys',
      }),
    );
    const resource = new AttestationsResource({
      accessToken: 'secret',
      fetch: fetchMock,
    });

    await expect(resource.request({ count: 1 })).rejects.toBeInstanceOf(
      LinkResponseError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses discovery redirects', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('', {
          status: 302,
          headers: { Location: 'https://attacker.example/metadata' },
        }),
    );
    const resource = new AttestationsResource({
      accessToken: 'secret',
      fetch: fetchMock,
    });

    await expect(resource.request({ count: 1 })).rejects.toThrow(
      'Refused redirect',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('wraps malformed issuer metadata in LinkResponseError', async () => {
    const resource = new AttestationsResource({
      accessToken: 'secret',
      fetch: vi.fn(async () => jsonResponse({ issuer: 42 })),
    });

    await expect(resource.request({ count: 1 })).rejects.toBeInstanceOf(
      LinkResponseError,
    );
  });

  it('refreshes LinkOptions authentication after an issuance 401', async () => {
    const { publicKey } = generateKeyPairSync('rsa-pss', {
      modulusLength: 2048,
      publicExponent: 0x10001,
      hashAlgorithm: 'sha384',
      mgf1HashAlgorithm: 'sha384',
    });
    const tokenKey = publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/.well-known/aap-issuer')) {
          return jsonResponse({
            issuer: 'https://api.link.com',
            token_issuance_endpoint:
              'https://api.link.com/identity/attestations',
            token_keys: 'https://api.link.com/token-keys',
          });
        }
        if (url.endsWith('/token-keys')) {
          return jsonResponse({
            'token-keys': [{ 'token-type': 0x0002, 'token-key': tokenKey }],
          });
        }
        return jsonResponse(
          { error: `unauthorized: ${String(init?.headers)}` },
          401,
        );
      },
    );
    const getAccessToken = vi.fn(
      ({ forceRefresh }: { forceRefresh?: boolean } = {}) =>
        forceRefresh ? 'refreshed-token' : 'initial-token',
    );
    const resource = new AttestationsResource({
      getAccessToken,
      fetch: fetchMock,
    });

    await expect(resource.request({ count: 1 })).rejects.toThrow(
      'Failed to issue attestation tokens (401)',
    );

    expect(getAccessToken).toHaveBeenNthCalledWith(1, undefined);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer initial-token',
        'Content-Type': 'application/json',
      }),
    });
    const issuanceBody = fetchMock.mock.calls[2]?.[1]?.body;
    const body = JSON.parse(String(issuanceBody));
    expect(body.token_key_id).toBe(
      createHash('sha256')
        .update(Buffer.from(tokenKey, 'base64'))
        .digest('base64url'),
    );
    expect(body.messages).toHaveLength(1);
    expect(Buffer.from(body.messages[0], 'base64url')).toHaveLength(256);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(issuanceBody);
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: 'Bearer refreshed-token',
      }),
    });
  });

  it('rejects a refused JSON attestation without returning any tokens', async () => {
    const { publicKey } = generateKeyPairSync('rsa-pss', {
      modulusLength: 2048,
      publicExponent: 0x10001,
      hashAlgorithm: 'sha384',
      mgf1HashAlgorithm: 'sha384',
    });
    const tokenKey = publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/aap-issuer')) {
        return jsonResponse({
          issuer: 'https://api.link.com',
          token_issuance_endpoint: 'https://api.link.com/identity/attestations',
          token_keys: 'https://api.link.com/token-keys',
        });
      }
      if (url.endsWith('/token-keys')) {
        return jsonResponse({
          'token-keys': [{ 'token-type': 0x0002, 'token-key': tokenKey }],
        });
      }
      return jsonResponse({ attestations: [null] });
    });
    const resource = new AttestationsResource({
      accessToken: 'secret',
      fetch: fetchMock,
    });

    await expect(resource.request({ count: 1 })).rejects.toThrow(
      'Issuer refused token request at index 0',
    );
  });
});

describe('attestation key activation', () => {
  const now = 2_000_000_000;
  const stagedKey = {
    'token-type': 0x0002,
    'token-key': Buffer.from('staged key').toString('base64url'),
    'not-before': now + 60,
  };
  const currentKey = {
    'token-type': 0x0002,
    'token-key': Buffer.from('current key').toString('base64url'),
  };

  function setup(keys: object[]) {
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    const selected = vi
      .spyOn(crypto, 'generateBlindedMessages')
      .mockImplementation(() => {
        throw new Error('selected key reached crypto');
      });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          issuer: 'https://api.link.com',
          token_keys: 'https://api.link.com/token-keys',
          token_issuance_endpoint: 'https://api.link.com/identity/attestations',
        }),
      )
      .mockResolvedValueOnce(Response.json({ 'token-keys': keys }));
    const getAccessToken = vi.fn(() => 'test-token');
    return {
      selected,
      fetch,
      getAccessToken,
      resource: new AttestationsResource({ getAccessToken, fetch }),
    };
  }

  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, now - 1, now])(
    'skips a staged key for an eligible key with not-before=%s',
    async (notBefore) => {
      const eligible =
        notBefore === undefined
          ? currentKey
          : { ...currentKey, 'not-before': notBefore };
      const { resource, selected } = setup([stagedKey, eligible]);

      await expect(resource.request({ count: 1 })).rejects.toThrow(
        'selected key reached crypto',
      );
      expect(selected).toHaveBeenCalledWith(
        new Uint8Array(Buffer.from('current key')),
        1,
        expect.any(Uint8Array),
      );
    },
  );

  it('fails before blinding or authentication when every key is staged', async () => {
    const { resource, selected, fetch, getAccessToken } = setup([stagedKey]);

    await expect(resource.request({ count: 1 })).rejects.toBeInstanceOf(
      LinkResponseError,
    );
    expect(selected).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('JSON attestation issuance', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });
  const pkcs1 = publicKey.export({ format: 'der', type: 'pkcs1' });
  const algorithm = Buffer.from(
    '303d06092a864886f70d01010a3030a00d300b0609608648016503040202' +
      'a11a301806092a864886f70d010108300b0609608648016503040202a203020130',
    'hex',
  );
  const bitStringLength = pkcs1.length + 1;
  const content = Buffer.concat([
    algorithm,
    Buffer.from([3, 0x82, bitStringLength >> 8, bitStringLength & 0xff, 0]),
    pkcs1,
  ]);
  const spki = Buffer.concat([
    Buffer.from([0x30, 0x82, content.length >> 8, content.length & 0xff]),
    content,
  ]);
  const tokenKeyId = createHash('sha256').update(spki).digest('base64url');
  const validEncoding = Buffer.alloc(256).toString('base64url');

  function setup(respond?: (signatures: string[]) => Response) {
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        switch (String(input)) {
          case 'https://api.link.com/.well-known/aap-issuer':
            expect(init?.headers).toBeUndefined();
            return jsonResponse({
              issuer: 'https://api.link.com',
              token_issuance_endpoint:
                'https://api.link.com/identity/attestations',
              token_keys:
                'https://api.link.com/.well-known/aap-issuer/token-keys',
            });
          case 'https://api.link.com/.well-known/aap-issuer/token-keys':
            return jsonResponse({
              'token-keys': [
                { 'token-type': 2, 'token-key': spki.toString('base64url') },
              ],
            });
          case 'https://api.link.com/identity/attestations': {
            expect(init).toMatchObject({
              method: 'POST',
              redirect: 'manual',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: 'Bearer synthetic-token',
              },
            });
            const body = JSON.parse(String(init?.body));
            expect(Object.keys(body).sort()).toEqual([
              'messages',
              'token_key_id',
            ]);
            expect(body.token_key_id).toBe(tokenKeyId);
            const signatures = body.messages.map((message: string) => {
              const bytes = Buffer.from(message, 'base64url');
              expect(bytes.length).toBe(256);
              expect(bytes.toString('base64url')).toBe(message);
              return privateDecrypt(
                { key: privateKey, padding: constants.RSA_NO_PADDING },
                bytes,
              ).toString('base64url');
            });
            return respond
              ? respond(signatures)
              : jsonResponse({ attestations: signatures });
          }
          default:
            throw new Error('Unexpected URL');
        }
      },
    );
    return {
      fetch,
      resource: new AttestationsResource({
        accessToken: 'synthetic-token',
        fetch,
      }),
    };
  }

  it.each([1, 3])(
    'unblinds and verifies a JSON batch of %i tokens',
    async (count) => {
      const { resource } = setup();
      const result = await resource.request({ count });
      expect(result.count).toBe(count);
      expect(result.token_key_id).toBe(tokenKeyId);
      expect(new Set(result.tokens).size).toBe(count);
      for (const encoded of result.tokens) {
        const token = Buffer.from(encoded, 'base64url');
        expect(token).toHaveLength(354);
        expect(token.subarray(66, 98).toString('base64url')).toBe(tokenKeyId);
        expect(
          verify(
            'sha384',
            token.subarray(0, 98),
            {
              key: publicKey,
              padding: constants.RSA_PKCS1_PSS_PADDING,
              saltLength: 48,
            },
            token.subarray(98),
          ),
        ).toBe(true);
      }
    },
  );

  it.each([
    ['missing array', {}],
    ['non-array', { attestations: 'invalid' }],
    ['wrong count', { attestations: [] }],
    ['extra entry', { attestations: [validEncoding, validEncoding] }],
    ['non-string entry', { attestations: [42] }],
    ['padded encoding', { attestations: [`${validEncoding}==`] }],
    [
      'noncanonical encoding',
      { attestations: [`${validEncoding.slice(0, -1)}B`] },
    ],
    ['invalid alphabet', { attestations: ['+not/base64url'] }],
    [
      'wrong signature size',
      { attestations: [Buffer.alloc(255).toString('base64url')] },
    ],
    ['corrupt signature', { attestations: [validEncoding] }],
  ])('rejects %s', async (_name, response) => {
    const { resource } = setup(() => jsonResponse(response));
    await expect(resource.request({ count: 1 })).rejects.toBeInstanceOf(
      LinkResponseError,
    );
  });

  it.each([0, 1, 2])(
    'rejects a refused slot at index %i without shifting signatures',
    async (index) => {
      const { resource } = setup((signatures) => {
        const attestations: (string | null)[] = [...signatures];
        attestations[index] = null;
        return jsonResponse({ attestations });
      });
      await expect(resource.request({ count: 3 })).rejects.toThrow(
        `Issuer refused token request at index ${index}`,
      );
    },
  );

  it('rejects malformed JSON', async () => {
    const { resource } = setup(() => new Response('{', { status: 200 }));
    await expect(resource.request({ count: 1 })).rejects.toBeInstanceOf(
      LinkResponseError,
    );
  });

  it.each([302, 400, 401, 404, 429, 500])(
    'does not fall back to a legacy endpoint after HTTP %i',
    async (status) => {
      const { resource, fetch } = setup(() =>
        jsonResponse({ error: 'rejected' }, status),
      );
      await expect(resource.request({ count: 1 })).rejects.toMatchObject({
        status,
      });
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );
});
