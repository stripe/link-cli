import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { link } from '@stripe/link-integrations-better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

const linkOptions = {
  clientId: process.env.LINK_CLIENT_ID ?? '',
  clientSecret: process.env.LINK_CLIENT_SECRET ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
};

async function initializeAuth() {
  const options = {
    baseURL: 'http://localhost:3000',
    // This example binds only to loopback and uses a persistent local development secret.
    secret:
      process.env.BETTER_AUTH_SECRET ??
      'local-only-link-next-example-secret-not-for-production',
    database: new DatabaseSync('example.sqlite'),
    emailAndPassword: { enabled: true },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        trustedProviders: ['link'],
        allowDifferentEmails: true,
      },
    },
    plugins: [link(linkOptions)],
  } satisfies BetterAuthOptions;

  // Local example only: initialize SQLite on the first request.
  await (await getMigrations(options)).runMigrations();
  return betterAuth(options);
}

// Reuse the connection across Next.js development reloads.
const local = globalThis as typeof globalThis & {
  linkExampleAuth?: ReturnType<typeof initializeAuth>;
};

export function getAuth() {
  local.linkExampleAuth ??= initializeAuth();
  return local.linkExampleAuth;
}
