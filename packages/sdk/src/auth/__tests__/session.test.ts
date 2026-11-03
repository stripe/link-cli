import { describe, expect, it, vi } from 'vitest';
import { LinkAuthenticationError } from '@/auth/errors';
import { createAccessTokenProvider } from '@/auth/session';
import type { AuthStorage, AuthTokens, IAuthResource } from '@/auth/types';

class MemoryAuthStorage implements AuthStorage {
  private tokens: AuthTokens | null;

  constructor(tokens: AuthTokens | null = null) {
    this.tokens = tokens;
  }

  getTokens(): AuthTokens | null {
    return this.tokens;
  }

  setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  clearTokens(): void {
    this.tokens = null;
  }
}

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
    const storage = new MemoryAuthStorage(null);
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
    const storage = new MemoryAuthStorage({
      access_token: 'at_cached',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
      expires_at: Date.now() + 3_600_000,
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage);

    expect(await provider()).toBe('at_cached');
    expect(repo.refreshToken).not.toHaveBeenCalled();
  });

  it('refreshes token when expired (within 60s buffer)', async () => {
    const storage = new MemoryAuthStorage({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 30,
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
    const storage = new MemoryAuthStorage({
      access_token: 'at_cached',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
      expires_at: Date.now() + 3_600_000,
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage);

    const token = await provider({ forceRefresh: true });

    expect(token).toBe('at_refreshed');
    expect(repo.refreshToken).toHaveBeenCalledWith('rt_123');
  });

  it('throws when noRefresh is true and token is expired', async () => {
    const storage = new MemoryAuthStorage({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 0,
      token_type: 'Bearer',
      expires_at: Date.now() + 30_000,
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage, {
      noRefresh: true,
    });

    await expect(provider()).rejects.toThrow(LinkAuthenticationError);
    expect(repo.refreshToken).not.toHaveBeenCalled();
  });

  it('throws when noRefresh is true and forceRefresh is requested', async () => {
    const storage = new MemoryAuthStorage({
      access_token: 'at_cached',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
      expires_at: Date.now() + 3_600_000,
    });
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, storage, {
      noRefresh: true,
    });

    await expect(provider({ forceRefresh: true })).rejects.toThrow(
      LinkAuthenticationError,
    );
    expect(repo.refreshToken).not.toHaveBeenCalled();
  });

  it('uses the provided not-authenticated and token-expired messages', async () => {
    const notAuthenticatedStorage = new MemoryAuthStorage(null);
    const repo = createMockAuthRepo();
    const provider = createAccessTokenProvider(repo, notAuthenticatedStorage, {
      notAuthenticatedMessage: 'custom: not authenticated',
    });

    await expect(provider()).rejects.toThrow('custom: not authenticated');

    const expiredStorage = new MemoryAuthStorage({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 0,
      token_type: 'Bearer',
      expires_at: Date.now() + 30_000,
    });
    const noRefreshProvider = createAccessTokenProvider(repo, expiredStorage, {
      noRefresh: true,
      tokenExpiredMessage: 'custom: token expired',
    });

    await expect(noRefreshProvider()).rejects.toThrow('custom: token expired');
  });

  it('shares a single in-flight refresh across concurrent callers', async () => {
    let resolveRefresh!: (value: AuthTokens) => void;
    const refreshPromise = new Promise<AuthTokens>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshToken = vi.fn(() => refreshPromise);
    const repo: IAuthResource = {
      initiateDeviceAuth: vi.fn(),
      pollDeviceAuth: vi.fn(),
      refreshToken,
      revokeToken: vi.fn(async () => {}),
    };

    const storage = new MemoryAuthStorage({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 30,
      token_type: 'Bearer',
      expires_at: Date.now() + 30_000,
    });
    const provider = createAccessTokenProvider(repo, storage);

    // Two concurrent calls both observe the same expired token.
    const callA = provider();
    const callB = provider();

    // Let both calls reach the refresh call before resolving it.
    await Promise.resolve();
    await Promise.resolve();

    resolveRefresh({
      access_token: 'at_rotated',
      refresh_token: 'rt_rotated',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    const [tokenA, tokenB] = await Promise.all([callA, callB]);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(tokenA).toBe('at_rotated');
    expect(tokenB).toBe('at_rotated');
  });
});
