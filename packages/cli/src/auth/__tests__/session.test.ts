import { LinkAuthenticationError, MemoryStorage } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createAccessTokenProvider } from '../session';
import type { IAuthResource } from '../types';

function createMockAuthRepo(
  refreshResult = {
    access_token: 'at_refreshed',
    refresh_token: 'rt_refreshed',
    expires_in: 3600,
    token_type: 'Bearer',
  },
): IAuthResource {
  return {
    initiateDeviceAuth: vi.fn(),
    pollDeviceAuth: vi.fn(),
    refreshToken: vi.fn(async () => refreshResult),
    revokeToken: vi.fn(async () => {}),
  };
}

describe('createAccessTokenProvider', () => {
  it('throws LinkAuthenticationError with not_authenticated code when no auth stored', async () => {
    const storage = new MemoryStorage(null);
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage);

    await expect(provider()).rejects.toThrow(LinkAuthenticationError);
    try {
      await provider();
    } catch (err) {
      expect((err as LinkAuthenticationError).code).toBe('not_authenticated');
    }
  });

  it('returns cached token when not expired', async () => {
    const storage = new MemoryStorage({
      access_token: 'at_cached',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage);

    expect(await provider()).toBe('at_cached');
    expect(repo.refreshToken).not.toHaveBeenCalled();
  });

  it('refreshes token when expired (within 60s buffer)', async () => {
    const storage = new MemoryStorage({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 30, // 30s, will be within 60s buffer after MemoryStorage computes expires_at
      token_type: 'Bearer',
    });
    // Override expires_at to be within the buffer
    storage.setAuth({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 0,
      token_type: 'Bearer',
      expires_at: Date.now() + 30_000,
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage);

    const token = await provider();

    expect(token).toBe('at_refreshed');
    expect(repo.refreshToken).toHaveBeenCalledWith('rt_123');
  });

  it('refreshes token when forceRefresh is true', async () => {
    const storage = new MemoryStorage({
      access_token: 'at_cached',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage);

    const token = await provider({ forceRefresh: true });

    expect(token).toBe('at_refreshed');
    expect(repo.refreshToken).toHaveBeenCalledWith('rt_123');
  });
});
