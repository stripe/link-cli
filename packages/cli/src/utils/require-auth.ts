import { storage } from '@stripe/link-sdk';
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

/**
 * Incur middleware that short-circuits with NOT_AUTHENTICATED if no auth tokens exist.
 * Use via `middleware: [requireAuth]` on command definitions.
 *
 * NOTE: Due to an incur limitation, this cannot be used on `async *run` (generator)
 * commands that call `c.error()` within the generator body. For those, use
 * `requireAuthGuard(c)` inside the handler instead.
 */
export const requireAuth: MiddlewareHandler = (c, next) => {
  if (!storage.isAuthenticated()) {
    return c.error(NOT_AUTHENTICATED_ERROR);
  }
  return next();
};

/**
 * Inline auth guard for generator commands where middleware doesn't work.
 * Call at the top of `async *run(c)` handlers.
 */
export function requireAuthGuard(c: {
  error: (err: AuthErrorOptions) => never;
}) {
  if (!storage.isAuthenticated()) {
    c.error(NOT_AUTHENTICATED_ERROR);
  }
}
