import type { AuthStorage } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { requireAuth, requireAuthGuard } from '../require-auth';

function makeStorage(authenticated: boolean): AuthStorage {
  return {
    isAuthenticated: vi.fn(() => authenticated),
    getAuth: vi.fn(() => null),
    setAuth: vi.fn(),
    clearAuth: vi.fn(),
    clearAll: vi.fn(),
    getPath: vi.fn(() => '/tmp/fake'),
  } as unknown as AuthStorage;
}

function makeContext() {
  const error = vi.fn();
  const next = vi.fn();
  return { c: { error } as unknown as Parameters<ReturnType<typeof requireAuth>>[0], next, error };
}

describe('requireAuth', () => {
  it('blocks when no stored auth and no env token', () => {
    const { c, next, error } = makeContext();
    const handler = requireAuth(makeStorage(false));
    handler(c, next);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_AUTHENTICATED' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('allows when stored auth is present', () => {
    const { c, next, error } = makeContext();
    const handler = requireAuth(makeStorage(true));
    handler(c, next);
    expect(error).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('allows when envAccessToken is set even with no stored auth', () => {
    const { c, next, error } = makeContext();
    const handler = requireAuth(makeStorage(false), 'tok_env_abc');
    handler(c, next);
    expect(error).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('allows when both envAccessToken and stored auth are present', () => {
    const { c, next, error } = makeContext();
    const handler = requireAuth(makeStorage(true), 'tok_env_abc');
    handler(c, next);
    expect(error).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('requireAuthGuard', () => {
  it('blocks when no stored auth and no env token', () => {
    const error = vi.fn(() => { throw new Error('auth error'); });
    expect(() => requireAuthGuard({ error } as never, makeStorage(false))).toThrow('auth error');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_AUTHENTICATED' }));
  });

  it('does not throw when stored auth is present', () => {
    const error = vi.fn();
    expect(() => requireAuthGuard({ error } as never, makeStorage(true))).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('does not throw when envAccessToken is set with no stored auth', () => {
    const error = vi.fn();
    expect(() => requireAuthGuard({ error } as never, makeStorage(false), 'tok_env_abc')).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
});
