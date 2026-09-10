import type { MiddlewareHandler } from 'incur';
import {
  type CliAuthStorage,
  storage as defaultStorage,
} from '../auth/storage';

interface AuthErrorOptions {
  code: string;
  message: string;
  cta?: { commands: { command: string; description: string }[] };
}

export const NOT_AUTHENTICATED_ERROR: AuthErrorOptions = {
  code: 'NOT_AUTHENTICATED',
  message: 'Not authenticated. Run "link-cli auth login" first.',
  cta: {
    commands: [{ command: 'auth login', description: 'Log in to Link' }],
  },
};

export function requireAuth(
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
): MiddlewareHandler {
  const store = authStorage ?? defaultStorage;
  return (c, next) => {
    if (!envAccessToken && !store.isAuthenticated()) {
      return c.error(NOT_AUTHENTICATED_ERROR);
    }
    return next();
  };
}

export function requireAuthGuard(
  c: { error: (err: AuthErrorOptions) => never },
  authStorage?: CliAuthStorage,
  envAccessToken?: string,
) {
  const store = authStorage ?? defaultStorage;
  if (!envAccessToken && !store.isAuthenticated()) {
    c.error(NOT_AUTHENTICATED_ERROR);
  }
}
