import type { AuthStorage, AuthTokens, IAuthResource } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createAccessTokenProvider } from '../session';

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

function createMockAuthRepo(): IAuthResource {
  return {
    initiateDeviceAuth: vi.fn(),
    pollDeviceAuth: vi.fn(),
    refreshToken: vi.fn(async () => ({
      access_token: 'at_refreshed',
      refresh_token: 'rt_refreshed',
      expires_in: 3600,
      token_type: 'Bearer',
    })),
    revokeToken: vi.fn(async () => {}),
  };
}

// The business logic (expiry, refresh, concurrent-refresh dedup) is covered
// by the SDK's own `createAccessTokenProvider` tests. This file only checks
// that the CLI's thin wrapper preserves its exact, pre-move user-facing
// messages.
describe('createAccessTokenProvider (CLI wrapper)', () => {
  it('keeps the CLI "not authenticated" message', async () => {
    const storage = new MemoryAuthStorage(null);
    const provider = createAccessTokenProvider(createMockAuthRepo(), storage);

    await expect(provider()).rejects.toThrow(
      'Not authenticated. Run "link-cli auth login" first.',
    );
  });

  it('keeps the CLI "token expired" message when noRefresh is set', async () => {
    const storage = new MemoryAuthStorage({
      access_token: 'at_old',
      refresh_token: 'rt_123',
      expires_in: 0,
      token_type: 'Bearer',
      expires_at: Date.now() + 30_000,
    });
    const provider = createAccessTokenProvider(createMockAuthRepo(), storage, {
      noRefresh: true,
    });

    await expect(provider()).rejects.toThrow(
      'Access token expired. Re-authenticate with "link-cli auth login".',
    );
  });
});
