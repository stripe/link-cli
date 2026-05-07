import { MemoryStorage } from '@/utils/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

const NOW = 1_000_000;

describe('isAuthenticated() expiry guard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a valid, non-expired token', () => {
    const authStorage = new MemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    vi.setSystemTime(NOW + 30_000); // 30s in — still valid
    expect(authStorage.isAuthenticated()).toBe(true);
  });

  it('returns false once the token has expired', () => {
    const authStorage = new MemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    expect(authStorage.isAuthenticated()).toBe(true);

    vi.setSystemTime(NOW + 61_000); // 1s past expiry
    expect(authStorage.isAuthenticated()).toBe(false);
  });

  it('returns false at the exact expiry moment (>= boundary)', () => {
    const authStorage = new MemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 60,
      token_type: 'Bearer',
    });

    vi.setSystemTime(NOW + 60_000); // exactly at expires_at
    expect(authStorage.isAuthenticated()).toBe(false);
  });

  it('respects a pre-set expires_at over expires_in', () => {
    // withComputedExpiry uses ?? so a supplied expires_at is preserved as-is.
    // If the caller passes an already-expired timestamp the token must be
    // rejected even if expires_in is large.
    const authStorage = new MemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 9999,
      expires_at: 1_000_000, // already in the past
      token_type: 'Bearer',
    });

    expect(authStorage.isAuthenticated()).toBe(false);
  });

  it('returns false after clearAuth()', () => {
    const authStorage = new MemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(authStorage.isAuthenticated()).toBe(true);
    authStorage.clearAuth();
    expect(authStorage.isAuthenticated()).toBe(false);
  });

  it('returns false after clearAll()', () => {
    const authStorage = new MemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    authStorage.setAuth({
      access_token: 'at_123',
      refresh_token: 'rt_123',
      expires_in: 3600,
      token_type: 'Bearer',
    });

    expect(authStorage.isAuthenticated()).toBe(true);
    authStorage.clearAll();
    expect(authStorage.isAuthenticated()).toBe(false);
  });

  it('returns false if no token is stored', () => {
    const authStorage = new MemoryStorage();
    expect(authStorage.isAuthenticated()).toBe(false);
  });
});
