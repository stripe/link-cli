import { afterEach, expect, it, vi } from 'vitest';
import type { IAuthResource } from '../../auth/types';
import { ResourceFactory } from '../resource-factory';

afterEach(() => vi.unstubAllEnvs());

it('keeps a persistent factory usable after a rotating issuer refreshes it', async () => {
  vi.stubEnv('LINK_HTTP_PROXY', '');
  const sentTokens: string[] = [];
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const token = new Headers(init?.headers).get('authorization') ?? '';
      sentTokens.push(token);
      if (token !== 'Bearer synthetic_new_access') {
        return Response.json({ error: 'expired' }, { status: 401 });
      }
      return Response.json({
        payment_details: [
          { id: 'pd_synthetic', type: 'card', name: 'Test', is_default: true },
        ],
      });
    },
  );
  let consumed = false;
  const refresh = vi.fn(async (token: string) => {
    if (token !== 'synthetic_old_refresh' || consumed)
      throw new Error('Refresh token has already rotated');
    consumed = true;
    return {
      access_token: 'synthetic_new_access',
      refresh_token: 'synthetic_new_refresh',
      expires_in: 3600,
      token_type: 'Bearer',
    };
  });
  const auth: IAuthResource = {
    refreshToken: refresh,
    initiateDeviceAuth: vi.fn(),
    pollDeviceAuth: vi.fn(),
    revokeToken: vi.fn(),
  };
  const factory = new ResourceFactory({
    envAccessToken: 'synthetic_old_access',
    envRefreshToken: 'synthetic_old_refresh',
    authResource: auth,
    fetch: fetcher as typeof fetch,
  });
  const resource = factory.createPaymentMethodsResource();
  expect(await resource.list()).toHaveLength(1);
  await expect(resource.list()).resolves.toHaveLength(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(sentTokens).toEqual([
    'Bearer synthetic_old_access',
    'Bearer synthetic_new_access',
    'Bearer synthetic_new_access',
  ]);
});

it('uses the latest refresh token for a later forced refresh', async () => {
  vi.stubEnv('LINK_HTTP_PROXY', '');
  const refresh = vi
    .fn()
    .mockResolvedValueOnce({
      access_token: 'access_1',
      refresh_token: 'refresh_1',
      expires_in: 3600,
      token_type: 'Bearer',
    })
    .mockResolvedValueOnce({
      access_token: 'access_2',
      refresh_token: 'refresh_2',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  const provider = new ResourceFactory({
    envAccessToken: 'access_0',
    envRefreshToken: 'refresh_0',
    authResource: {
      refreshToken: refresh,
      initiateDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn(),
      revokeToken: vi.fn(),
    },
  }).getAccessTokenProvider();
  expect(await provider({ forceRefresh: true })).toBe('access_1');
  expect(await provider({ forceRefresh: true })).toBe('access_2');
  expect(refresh.mock.calls).toEqual([['refresh_0'], ['refresh_1']]);
  expect(await provider()).toBe('access_2');
});

it('retains the current token pair if a later refresh fails', async () => {
  vi.stubEnv('LINK_HTTP_PROXY', '');
  const refresh = vi
    .fn()
    .mockResolvedValueOnce({
      access_token: 'access_1',
      refresh_token: 'refresh_1',
      expires_in: 3600,
      token_type: 'Bearer',
    })
    .mockRejectedValueOnce(new Error('Temporary refresh failure'))
    .mockResolvedValueOnce({
      access_token: 'access_2',
      refresh_token: 'refresh_2',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  const provider = new ResourceFactory({
    envAccessToken: 'access_0',
    envRefreshToken: 'refresh_0',
    authResource: {
      refreshToken: refresh,
      initiateDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn(),
      revokeToken: vi.fn(),
    },
  }).getAccessTokenProvider();
  await provider({ forceRefresh: true });
  await expect(provider({ forceRefresh: true })).rejects.toThrow(
    'Temporary refresh failure',
  );
  expect(await provider()).toBe('access_1');
  expect(await provider({ forceRefresh: true })).toBe('access_2');
  expect(refresh.mock.calls).toEqual([
    ['refresh_0'],
    ['refresh_1'],
    ['refresh_1'],
  ]);
});
