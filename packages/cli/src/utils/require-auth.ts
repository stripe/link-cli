import type { AuthStorage } from '@stripe/link-sdk';
import { storage as defaultStorage } from '@stripe/link-sdk';
import type { MiddlewareHandler } from 'incur';

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

export function requireAuth(authStorage?: AuthStorage): MiddlewareHandler {
  const store = authStorage ?? defaultStorage;
  return (c, next) => {
    if (!store.isAuthenticated()) {
      return c.error(NOT_AUTHENTICATED_ERROR);
    }
    return next();
  };
}

export function requireAuthGuard(
  c: { error: (err: AuthErrorOptions) => never },
  authStorage?: AuthStorage,
) {
  const store = authStorage ?? defaultStorage;
  if (!store.isAuthenticated()) {
    c.error(NOT_AUTHENTICATED_ERROR);
  }
}
