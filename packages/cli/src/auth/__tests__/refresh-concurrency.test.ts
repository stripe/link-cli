import { expect, it, vi } from 'vitest';
import { createAccessTokenProvider } from '../session';
import type { AuthStorage, AuthTokens, IAuthResource } from '../types';

it('lets concurrent callers share one successful single-use refresh', async () => {
  let tokens: AuthTokens = {
    access_token: 'synthetic_expired',
    refresh_token: 'synthetic_refresh',
    expires_in: 0,
    expires_at: Date.now() - 1000,
    token_type: 'Bearer',
  };
  const storage: AuthStorage = {
    getTokens: () => tokens,
    setTokens: (value) => {
      tokens = value;
    },
    clearTokens: vi.fn(),
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let consumed = false;
  const refresh = vi.fn(async () => {
    if (consumed) throw new Error('Refresh token was already consumed');
    consumed = true;
    await gate;
    return {
      access_token: 'synthetic_new',
      refresh_token: 'synthetic_rotated',
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
  const provider = createAccessTokenProvider(auth, storage);
  const calls = Promise.allSettled([provider(), provider(), provider()]);
  await Promise.resolve();
  await Promise.resolve();
  release();
  const outcomes = await calls;
  expect(outcomes.map((r) => r.status)).toEqual(Array(3).fill('fulfilled'));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('releases a rejected shared refresh so the next call can retry', async () => {
  const old: AuthTokens = {
    access_token: 'old',
    refresh_token: 'refresh_old',
    expires_in: 0,
    expires_at: Date.now() - 1000,
    token_type: 'Bearer',
  };
  const storage: AuthStorage = {
    getTokens: () => old,
    setTokens: vi.fn(),
    clearTokens: vi.fn(),
  };
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error('Temporary issuer failure'))
    .mockResolvedValueOnce({
      access_token: 'new',
      refresh_token: 'refresh_new',
      expires_in: 3600,
      token_type: 'Bearer',
    });
  const auth: IAuthResource = {
    refreshToken: refresh,
    initiateDeviceAuth: vi.fn(),
    pollDeviceAuth: vi.fn(),
    revokeToken: vi.fn(),
  };
  const provider = createAccessTokenProvider(auth, storage);
  const rejected = await Promise.allSettled([
    provider(),
    provider(),
    provider(),
  ]);
  expect(rejected.map((r) => r.status)).toEqual(Array(3).fill('rejected'));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(await provider()).toBe('new');
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('shares forced refreshes until the new tokens have been persisted', async () => {
  const old: AuthTokens = {
    access_token: 'old',
    refresh_token: 'refresh_old',
    expires_in: 3600,
    expires_at: Date.now() + 3_600_000,
    token_type: 'Bearer',
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.fn(async () => {
    await gate;
  });
  const storage: AuthStorage = {
    getTokens: () => old,
    setTokens: write,
    clearTokens: vi.fn(),
  };
  const refresh = vi.fn(async () => ({
    access_token: 'new',
    refresh_token: 'refresh_new',
    expires_in: 3600,
    token_type: 'Bearer',
  }));
  const provider = createAccessTokenProvider(
    {
      refreshToken: refresh,
      initiateDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn(),
      revokeToken: vi.fn(),
    },
    storage,
  );
  const first = provider({ forceRefresh: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(1);
  const second = provider({ forceRefresh: true });
  await Promise.resolve();
  release();
  expect(await Promise.all([first, second])).toEqual(['new', 'new']);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});
