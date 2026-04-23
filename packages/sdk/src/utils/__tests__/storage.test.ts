import { MemoryStorage } from '@/utils/storage';
import { describe, expect, it } from 'vitest';

describe('MemoryStorage', () => {
  it('computes expires_at when storing auth tokens', () => {
    const authStorage = new MemoryStorage();

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    const stored = authStorage.getAuth();
    expect(stored?.expires_at).toBeTypeOf('number');
    expect(stored?.expires_at).toBeGreaterThan(Date.now());
  });

  it('can be initialized with an existing auth session', () => {
    const authStorage = new MemoryStorage({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    expect(authStorage.isAuthenticated()).toBe(true);
    expect(authStorage.getPath()).toBe('memory');
  });

  it('deleteConfig is a no-op for MemoryStorage', () => {
    const authStorage = new MemoryStorage({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });
    expect(() => authStorage.deleteConfig()).not.toThrow();
    // auth is unaffected
    expect(authStorage.isAuthenticated()).toBe(true);
  });
});
