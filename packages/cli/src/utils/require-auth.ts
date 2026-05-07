import { storage } from '@stripe/link-sdk';

export const NOT_AUTHENTICATED_ERROR = {
  code: 'NOT_AUTHENTICATED',
  message: 'Not authenticated. Run "link-cli auth login" first.',
  cta: {
    commands: [{ command: 'auth login', description: 'Log in to Link' }],
  },
} as const;

export function requireAuth(c: { error: (err: unknown) => unknown }) {
  if (!storage.isAuthenticated()) {
    return c.error(NOT_AUTHENTICATED_ERROR);
  }
  return null;
}
