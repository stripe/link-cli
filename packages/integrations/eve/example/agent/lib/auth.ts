import { createHmac } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { link } from '@stripe/link-integrations-better-auth';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';

export function config() {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Set ${name} in example/.env.local.`);
    return value;
  };
  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const url = new URL(origin);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.origin !== origin
  ) {
    throw new Error(
      'This terminal example requires a localhost BETTER_AUTH_URL.',
    );
  }
  return {
    origin,
    secret: required('BETTER_AUTH_SECRET'),
    clientId: required('LINK_CLIENT_ID'),
    clientSecret: required('LINK_CLIENT_SECRET'),
    publishableKey: required('STRIPE_PUBLISHABLE_KEY'),
  };
}

async function initialize() {
  const { origin, secret, ...credentials } = config();
  const directory = resolve(process.env.LINK_EXAMPLE_DATA_DIR ?? '.data');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, 'auth.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const options = {
    baseURL: origin,
    secret,
    database: db,
    emailAndPassword: { enabled: true },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        trustedProviders: ['link'],
        allowDifferentEmails: true,
      },
    },
    plugins: [
      link({
        ...credentials,
        // Transaction access for insights. Add read_external_transactions if
        // your Stripe account is registered for Financial Connections.
        authorizationDetails: [
          { type: 'source', actions: ['read_link_transactions'] },
        ],
      }),
    ],
    logger: { disabled: true },
  } satisfies BetterAuthOptions;
  await (await getMigrations(options)).runMigrations();
  return { auth: betterAuth(options), db };
}

const local = globalThis as typeof globalThis & {
  linkTerminalAuth?: ReturnType<typeof initialize>;
  linkTerminalSession?: ReturnType<typeof signInTerminal>;
};

export function getAuth() {
  local.linkTerminalAuth ??= initialize();
  return local.linkTerminalAuth;
}

async function signInTerminal() {
  const { auth, db } = await getAuth();
  // One local app user. Call only in Eve dev mode, with the server on localhost.
  const email = 'terminal@link-example.invalid';
  const password = createHmac('sha256', config().secret)
    .update(email)
    .digest('hex');
  if (!db.prepare('SELECT id FROM user WHERE email = ?').get(email)) {
    await auth.api.signUpEmail({
      body: { email, password, name: 'Local terminal' },
    });
  }
  return auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
}

export function getTerminalSession() {
  local.linkTerminalSession ??= signInTerminal();
  return local.linkTerminalSession;
}

export function sessionHeaders(headers: Headers) {
  return new Headers({
    origin: config().origin,
    cookie: headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  });
}
