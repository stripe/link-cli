import { storage } from '@stripe/link-sdk';

interface AuthErrorOptions {
  code: string;
  message: string;
  cta?: { commands: { command: string; description: string }[] };
}

const NOT_AUTHENTICATED_ERROR: AuthErrorOptions = {
  code: 'NOT_AUTHENTICATED',
  message: 'Not authenticated. Run "link-cli auth login" first.',
  cta: {
    commands: [{ command: 'auth login', description: 'Log in to Link' }],
  },
};

export function requireAuth(c: { error: (err: AuthErrorOptions) => never }) {
  if (!storage.isAuthenticated()) {
    return c.error(NOT_AUTHENTICATED_ERROR);
  }
  return null;
}
