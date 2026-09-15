import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { createAuthClient } from 'better-auth/client';
import { getMigrations } from 'better-auth/db/migration';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { link } from '../src/index';

const credentials = {
  clientId: 'link-client',
  clientSecret: 'link-secret',
  publishableKey: 'pk_test_link',
};
const databases: DatabaseSync[] = [];

class Cookies {
  values = new Map<string, string>();
  absorb(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      this.values.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
  toString() {
    return [...this.values].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

async function fixture(
  strategy: 'database' | 'cookie' = 'database',
  basePath = '/api/auth',
) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const options = {
    database,
    baseURL: 'http://localhost:3000',
    basePath,
    secret: 'a-test-secret-long-enough-for-better-auth-123456789',
    emailAndPassword: { enabled: true },
    socialProviders: {
      github: { clientId: 'github-client', clientSecret: 'github-secret' },
    },
    account: {
      storeStateStrategy: strategy,
      encryptOAuthTokens: true,
      accountLinking: {
        trustedProviders: ['link'],
        allowDifferentEmails: true,
      },
    },
    logger: { disabled: true },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    plugins: [link(credentials)],
  };
  await (await getMigrations(options)).runMigrations();
  const auth = betterAuth(options);
  const cookies = new Cookies();
  async function request(path: string, body?: unknown, jar = cookies) {
    const response = await auth.handler(
      new Request(`${options.baseURL}${basePath}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin: options.baseURL,
          cookie: jar.toString(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    jar.absorb(response);
    return response;
  }
  async function signUp(email = 'app@example.com', jar = cookies) {
    const response = await request(
      '/sign-up/email',
      { email, password: 'password123456', name: 'App User' },
      jar,
    );
    expect(response.status).toBe(200);
    return (await response.json()).user.id as string;
  }
  const userId = await signUp();
  const client = createAuthClient({
    baseURL: options.baseURL,
    basePath,
    fetchOptions: {
      customFetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('cookie', cookies.toString());
        headers.set('origin', options.baseURL);
        const response = await auth.handler(
          new Request(input, { ...init, headers }),
        );
        cookies.absorb(response);
        return response;
      },
    },
  });
  async function start() {
    const result = await client.linkSocial({
      provider: 'link',
      callbackURL: '/done',
      errorCallbackURL: '/failed',
    });
    expect(result.error).toBeNull();
    return new URL(result.data?.url ?? '');
  }
  async function complete(url: URL) {
    return request(
      `/callback/link?state=${url.searchParams.get('state')}&code=code-one`,
    );
  }
  async function connect() {
    expect((await complete(await start())).headers.get('location')).toBe(
      '/done',
    );
    const accounts = await client.listAccounts();
    const account = accounts.data?.find(
      (account) => account.providerId === 'link',
    );
    if (!account) throw new Error('No Link account');
    return account;
  }
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input) === 'https://api.link.com/userinfo') {
      return Response.json({
        email: 'wallet@example.com',
        first_name: 'Link',
        last_name: 'User',
      });
    }
    if (String(input) === 'https://login.link.com/auth/revoke')
      return new Response(null, { status: 200 });
    return Response.json({
      access_token: 'access-one',
      refresh_token: 'refresh-one',
      expires_in: 3600,
      scope: 'payment_methods.agentic,userinfo:read',
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    auth,
    client,
    database,
    request,
    cookies,
    userId,
    signUp,
    start,
    complete,
    connect,
    fetchMock,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

describe.each(['database', 'cookie'] as const)('%s OAuth state', (strategy) => {
  it('uses native linking, PKCE, account storage, and token retrieval', async () => {
    const f = await fixture(strategy);
    const users = f.database.prepare('select * from user').all();
    const url = await f.start();
    expect(url.origin + url.pathname).toBe('https://login.link.com/auth');
    expect(url.searchParams.get('key')).toBe(credentials.publishableKey);
    expect(url.searchParams.get('scope')).toBe(
      'payment_methods.agentic userinfo:read',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/callback/link',
    );
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect((await f.complete(url)).headers.get('location')).toBe('/done');
    const exchange = f.fetchMock.mock.calls[0];
    expect(String(exchange?.[0])).toBe('https://login.link.com/auth/token');
    expect(new Headers(exchange?.[1]?.headers).get('authorization')).toBe(
      `Bearer ${credentials.publishableKey}`,
    );
    const body = new URLSearchParams(String(exchange?.[1]?.body));
    expect(body.get('client_id')).toBe(credentials.clientId);
    expect(body.get('client_secret')).toBe(credentials.clientSecret);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(url.searchParams.get('redirect_uri'));
    expect(
      createHash('sha256')
        .update(body.get('code_verifier') ?? '')
        .digest('base64url'),
    ).toBe(url.searchParams.get('code_challenge'));
    expect(f.database.prepare('select * from user').all()).toEqual(users);
    const account = f.database
      .prepare("select * from account where providerId = 'link'")
      .get();
    expect(account?.accountId).toBe('wallet@example.com');
    expect(account?.userId).toBe(f.userId);
    expect(account?.accessToken).not.toContain('access-one');
    expect(account?.refreshToken).not.toContain('refresh-one');
    const accountId = String(account?.id);
    expect(
      (await f.client.getAccessToken({ accountId })).data?.accessToken,
    ).toBe('access-one');
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect((await f.complete(url)).headers.get('location')).not.toBe('/done');
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect(
      f.database
        .prepare("select name from sqlite_master where name = 'linkConnection'")
        .get(),
    ).toBeUndefined();
  });

  it('rejects missing, mismatched, and expired state and handles denial', async () => {
    const f = await fixture(strategy);
    expect(
      (await f.request('/callback/link?code=code')).headers.get('location'),
    ).toContain('error=state_not_found');
    await f.start();
    expect(
      (await f.request('/callback/link?state=wrong&code=code')).headers.get(
        'location',
      ),
    ).toContain('error=state_mismatch');
    let url = await f.start();
    const denied = await f.request(
      `/callback/link?state=${url.searchParams.get('state')}&error=access_denied`,
    );
    expect(denied.headers.get('location')).toBe('/failed?error=access_denied');
    url = await f.start();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    expect((await f.complete(url)).headers.get('location')).toContain(
      'error=state_mismatch',
    );
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
});

it('requires app sign-in and blocks Link sign-in while preserving other social providers', async () => {
  const f = await fixture();
  expect(
    (
      await f.request(
        '/link-social',
        { provider: 'link', callbackURL: '/done' },
        new Cookies(),
      )
    ).status,
  ).toBe(401);
  expect(
    (await f.client.signIn.social({ provider: 'link', callbackURL: '/done' }))
      .error?.status,
  ).toBe(403);
  const github = await f.client.signIn.social({
    provider: 'github',
    callbackURL: '/done',
  });
  expect(github.error).toBeNull();
  expect(github.data?.url).toContain('github.com');
  // A different provider's sign-in state cannot turn Link into a sign-in mechanism.
  const state = new URL(github.data?.url ?? '').searchParams.get('state');
  const callback = await f.request(`/callback/link?state=${state}&code=code`);
  expect(callback.headers.get('location')).toContain(
    'error=unable_to_get_user_info',
  );
  expect(
    f.database.prepare("select * from account where providerId = 'link'").all(),
  ).toHaveLength(0);
});

it('rejects a missing email and prevents linking an existing Link email to another app user', async () => {
  const f = await fixture();
  const first = await f.connect();
  f.fetchMock.mockImplementationOnce(async () =>
    Response.json({ access_token: 'access', refresh_token: 'refresh' }),
  );
  f.fetchMock.mockImplementationOnce(async () =>
    Response.json({ first_name: 'Missing Email' }),
  );
  expect((await f.complete(await f.start())).headers.get('location')).toContain(
    'error=unable_to_get_user_info',
  );
  await f.signUp('other@example.com');
  expect((await f.complete(await f.start())).headers.get('location')).toContain(
    'error=account_already_linked_to_different_user',
  );
  expect(
    f.database.prepare('select userId from account where id = ?').get(first.id)
      ?.userId,
  ).toBe(f.userId);
});

it('uses native refresh and background token access, retaining rotated tokens for revocation', async () => {
  const f = await fixture();
  const account = await f.connect();
  const ctx = await f.auth.$context;
  await ctx.internalAdapter.updateAccount(account.id, {
    accessTokenExpiresAt: new Date(0),
  });
  f.fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: 'access-two',
      refresh_token: 'refresh-two',
      expires_in: 3600,
    }),
  );
  expect(
    (await f.client.getAccessToken({ accountId: account.id })).data
      ?.accessToken,
  ).toBe('access-two');
  const refresh = f.fetchMock.mock.lastCall;
  const body = new URLSearchParams(String(refresh?.[1]?.body));
  expect(body.get('grant_type')).toBe('refresh_token');
  expect(body.get('refresh_token')).toBe('refresh-one');
  expect(body.get('client_secret')).toBe(credentials.clientSecret);
  expect(new Headers(refresh?.[1]?.headers).get('authorization')).toBe(
    `Bearer ${credentials.publishableKey}`,
  );
  await f.client.signOut();
  expect(
    await f.auth.api.getAccessToken({
      body: { accountId: account.id, userId: f.userId },
    }),
  ).toMatchObject({ accessToken: 'access-two' });
  expect(
    (
      await f.request(
        '/get-access-token',
        { accountId: account.id, userId: f.userId },
        new Cookies(),
      )
    ).status,
  ).toBe(401);
  await f.client.signIn.email({
    email: 'app@example.com',
    password: 'password123456',
  });
  expect(
    (await f.client.unlinkAccount({ accountId: account.id })).error,
  ).toBeNull();
  expect(String(f.fetchMock.mock.lastCall?.[0])).toBe(
    'https://login.link.com/auth/revoke',
  );
  expect(
    new URLSearchParams(String(f.fetchMock.mock.lastCall?.[1]?.body)).get(
      'token',
    ),
  ).toBe('refresh-two');
  expect(
    (await f.client.listAccounts()).data?.some(
      (row) => row.providerId === 'link',
    ),
  ).toBe(false);
});

it('keeps unlink retryable when revocation fails and never revokes another user’s account', async () => {
  const f = await fixture();
  const account = await f.connect();
  f.fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(
    (await f.client.unlinkAccount({ accountId: account.id })).error?.status,
  ).toBe(502);
  expect(
    (await f.client.listAccounts()).data?.some((row) => row.id === account.id),
  ).toBe(true);
  await f.signUp('other@example.com');
  const callCount = f.fetchMock.mock.calls.length;
  expect(
    (await f.client.unlinkAccount({ accountId: account.id })).error,
  ).not.toBeNull();
  expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
  await f.client.signIn.email({
    email: 'app@example.com',
    password: 'password123456',
  });
  expect(
    (await f.client.unlinkAccount({ accountId: account.id })).error,
  ).toBeNull();
});

it('uses a custom base path and native redirect validation', async () => {
  const f = await fixture('database', '/custom/auth');
  const url = await f.start();
  expect(url.searchParams.get('redirect_uri')).toBe(
    'http://localhost:3000/custom/auth/callback/link',
  );
  expect((await f.complete(url)).headers.get('location')).toBe('/done');
  expect(
    (
      await f.client.linkSocial({
        provider: 'link',
        callbackURL: 'https://evil.example',
      })
    ).error?.status,
  ).toBe(403);
});

it('validates required credentials', () => {
  for (const field of ['clientId', 'clientSecret', 'publishableKey'] as const) {
    expect(() => link({ ...credentials, [field]: '' })).toThrow(
      `Link ${field} is required.`,
    );
  }
});
