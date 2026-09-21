import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { createAuthClient } from 'better-auth/client';
import { getMigrations } from 'better-auth/db/migration';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { linkClient } from '../src/client';
import { link } from '../src/index';

const credentials = {
  clientId: 'link-client',
  clientSecret: 'link-secret',
  publishableKey: 'pk_test_link',
};
const linkProfile = {
  id: 'link_user_AbC123',
  email: 'wallet@example.com',
  first_name: 'Link',
  last_name: 'User',
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
  linkOptions: { redirectURI?: string; scopes?: string[] } = {},
  authOptions: {
    encryptOAuthTokens?: boolean;
    allowUnlinkingAll?: boolean;
    cookieCache?: boolean;
  } = {},
) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const options = {
    database,
    baseURL: 'http://localhost:3000',
    basePath,
    secret: 'a-test-secret-long-enough-for-better-auth-123456789',
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: authOptions.cookieCache ?? false } },
    socialProviders: {
      github: { clientId: 'github-client', clientSecret: 'github-secret' },
    },
    account: {
      storeStateStrategy: strategy,
      encryptOAuthTokens: authOptions.encryptOAuthTokens ?? true,
      accountLinking: {
        trustedProviders: ['link'],
        allowDifferentEmails: true,
        allowUnlinkingAll: authOptions.allowUnlinkingAll ?? false,
      },
    },
    logger: { disabled: true },
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    plugins: [link({ ...credentials, ...linkOptions })],
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
    plugins: [linkClient()],
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
    const result = await client.link.connect({
      callbackURL: '/done',
      errorCallbackURL: '/failed',
    });
    expect(result.error).toBeNull();
    return new URL(result.data?.url ?? '');
  }
  async function startSignIn() {
    const result = await client.signIn.social({
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
  let profile: Record<string, unknown> = { ...linkProfile };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input) === 'https://login.link.com/auth/revoke') {
      return new Response(null, { status: 200 });
    }
    if (String(input) === 'https://api.link.com/userinfo') {
      return Response.json(profile);
    }
    expect(String(input)).toBe('https://login.link.com/auth/token');
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
    startSignIn,
    complete,
    connect,
    fetchMock,
    setProfile(nextProfile: Record<string, unknown>) {
      profile = nextProfile;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

describe.each(['database', 'cookie'] as const)('%s OAuth state', (strategy) => {
  it('creates a user with Link and signs back in by stable ID after an email change', async () => {
    const f = await fixture(strategy);
    await f.client.signOut();
    const url = await f.startSignIn();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect((await f.complete(url)).headers.get('location')).toBe('/done');
    const firstSession = await f.client.getSession();
    const linkUser = firstSession.data?.user;
    expect(linkUser).toMatchObject({
      email: linkProfile.email,
      name: 'Link User',
      emailVerified: false,
    });
    expect(linkUser?.id).toBeTruthy();
    expect(linkUser?.id).not.toBe(f.userId);
    expect(linkUser?.id).not.toBe(linkProfile.id);
    const accounts = await f.client.listAccounts();
    expect(accounts.data).toHaveLength(1);
    const account = accounts.data?.[0];
    expect(account).toMatchObject({
      providerId: 'link',
      accountId: linkProfile.id,
      userId: linkUser?.id,
    });
    expect(account).not.toHaveProperty('accessToken');
    expect(account).not.toHaveProperty('refreshToken');
    await f.client.signOut();
    f.setProfile({ ...linkProfile, email: 'changed@example.com' });
    expect(
      (await f.complete(await f.startSignIn())).headers.get('location'),
    ).toBe('/done');
    expect((await f.client.getSession()).data?.user.id).toBe(linkUser?.id);
    expect((await f.client.listAccounts()).data).toEqual([
      expect.objectContaining({ id: account?.id, accountId: linkProfile.id }),
    ]);
    expect(f.database.prepare('select * from user').all()).toHaveLength(2);
  });

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
    expect(account?.accountId).toBe(linkProfile.id);
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

  it('uses a custom redirect URI for authorization and token exchange', async () => {
    const redirectURI = 'http://127.0.0.1:8787/callback';
    const f = await fixture(strategy, '/api/auth', { redirectURI });
    const url = await f.start();
    expect(url.searchParams.get('redirect_uri')).toBe(redirectURI);
    expect((await f.complete(url)).headers.get('location')).toBe('/done');
    const body = new URLSearchParams(
      String(f.fetchMock.mock.calls[0]?.[1]?.body),
    );
    expect(body.get('redirect_uri')).toBe(redirectURI);
    expect((await f.client.listAccounts()).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ providerId: 'link' })]),
    );
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

it('requires app sign-in for explicit linking and preserves other social providers', async () => {
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
  const github = await f.client.signIn.social({
    provider: 'github',
    callbackURL: '/done',
  });
  expect(github.error).toBeNull();
  expect(github.data?.url).toContain('github.com');
});

it('signs in an existing app user through their linked Link account', async () => {
  const f = await fixture();
  const account = await f.connect();
  await f.client.signOut();
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe('/done');
  expect((await f.client.getSession()).data?.user.id).toBe(f.userId);
  expect((await f.client.listAccounts()).data).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: account.id })]),
  );
  expect(f.database.prepare('select * from user').all()).toHaveLength(1);
});

it('preserves Better Auth verification requirements when sign-in matches an unlinked app email', async () => {
  const f = await fixture();
  await f.client.signOut();
  f.setProfile({ ...linkProfile, email: 'app@example.com' });
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe('/failed?error=account_not_linked');
  expect((await f.client.getSession()).data).toBeNull();
  expect(f.database.prepare('select * from user').all()).toHaveLength(1);
  expect(
    f.database.prepare("select * from account where providerId = 'link'").all(),
  ).toHaveLength(0);
});

it.each([
  {
    profile: { ...linkProfile, id: undefined },
    error: 'unable_to_get_user_info',
  },
  { profile: { ...linkProfile, email: undefined }, error: 'email_not_found' },
])('rejects social sign-up with $error', async ({ profile, error }) => {
  const f = await fixture();
  await f.client.signOut();
  f.setProfile(profile);
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe(`/failed?error=${error}`);
  expect((await f.client.getSession()).data).toBeNull();
  expect(f.database.prepare('select * from user').all()).toHaveLength(1);
});

it('preserves Better Auth’s protection for the user’s only sign-in method', async () => {
  const f = await fixture();
  await f.client.signOut();
  expect(
    (await f.complete(await f.startSignIn())).headers.get('location'),
  ).toBe('/done');
  const accounts = await f.client.listAccounts();
  expect(accounts.data).toHaveLength(1);
  const accountId = accounts.data?.[0]?.id;
  if (!accountId) throw new Error('Expected a Link account');
  const callCount = f.fetchMock.mock.calls.length;
  const result = await f.client.link.disconnect({ accountId });
  expect(result.error?.status).toBe(400);
  expect(result.error?.code).toBe('FAILED_TO_UNLINK_LAST_ACCOUNT');
  expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
  expect((await f.client.listAccounts()).data).toHaveLength(1);
});

it.each([undefined, null, '', ' \t', 123, {}, []])(
  'rejects an invalid Link id (%j) without falling back to email',
  async (id) => {
    const f = await fixture();
    f.setProfile({ ...linkProfile, id });
    expect((await f.complete(await f.start())).headers.get('location')).toBe(
      '/failed?error=unable_to_get_user_info',
    );
    expect(
      f.database
        .prepare("select * from account where providerId = 'link'")
        .all(),
    ).toHaveLength(0);
  },
);

it('links by ID when email is absent and the app permits different emails', async () => {
  const f = await fixture();
  f.setProfile({ id: linkProfile.id, first_name: 'Link', last_name: 'User' });
  expect((await f.connect()).accountId).toBe(linkProfile.id);
});

it('keeps the same account when the Link email changes', async () => {
  const f = await fixture();
  const users = f.database.prepare('select * from user').all();
  const first = await f.connect();
  f.setProfile({ ...linkProfile, email: 'changed@example.com' });
  const reconnected = await f.connect();
  expect(reconnected.id).toBe(first.id);
  expect(reconnected.accountId).toBe(linkProfile.id);
  expect(
    f.database.prepare("select * from account where providerId = 'link'").all(),
  ).toHaveLength(1);
  expect(f.database.prepare('select * from user').all()).toEqual(users);
});

it('exposes the Link ID through accountInfo and preserves native account ownership', async () => {
  const f = await fixture();
  const account = await f.connect();
  const info = await f.client.accountInfo({ query: { accountId: account.id } });
  expect(info.error).toBeNull();
  expect(info.data).toMatchObject({
    account: { id: account.id, providerId: 'link', accountId: linkProfile.id },
    user: { email: linkProfile.email, name: 'Link User' },
    data: linkProfile,
  });
  expect(info.data?.account).not.toHaveProperty('accessToken');
  expect(info.data?.account).not.toHaveProperty('refreshToken');
  await f.signUp('other@example.com');
  expect(
    (await f.client.accountInfo({ query: { accountId: account.id } })).error,
  ).not.toBeNull();
});

it('prevents linking an existing Link ID to another app user even after an email change', async () => {
  const f = await fixture();
  const first = await f.connect();
  await f.signUp('other@example.com');
  f.setProfile({ ...linkProfile, email: 'other@example.com' });
  expect((await f.complete(await f.start())).headers.get('location')).toContain(
    'error=account_already_linked_to_different_user',
  );
  expect(
    f.database.prepare('select userId from account where id = ?').get(first.id)
      ?.userId,
  ).toBe(f.userId);
});

it('uses native refresh and background token access, retaining rotated refresh tokens', async () => {
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
  await ctx.internalAdapter.updateAccount(account.id, {
    accessTokenExpiresAt: new Date(0),
  });
  f.fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: 'access-three',
      refresh_token: 'refresh-three',
      expires_in: 3600,
    }),
  );
  expect(
    (await f.client.getAccessToken({ accountId: account.id })).data
      ?.accessToken,
  ).toBe('access-three');
  const rotatedBody = new URLSearchParams(
    String(f.fetchMock.mock.lastCall?.[1]?.body),
  );
  expect(rotatedBody.get('refresh_token')).toBe('refresh-two');
  await f.client.signOut();
  expect(
    await f.auth.api.getAccessToken({
      body: { accountId: account.id, userId: f.userId },
    }),
  ).toMatchObject({ accessToken: 'access-three' });
  expect(
    (
      await f.request(
        '/get-access-token',
        { accountId: account.id, userId: f.userId },
        new Cookies(),
      )
    ).status,
  ).toBe(401);
});

describe('Link actions', () => {
  it('registers the plugin and error codes with Better Auth', async () => {
    const f = await fixture();
    const ctx = await f.auth.$context;
    const plugin = ctx.getPlugin('link');

    expectTypeOf(plugin).toEqualTypeOf<ReturnType<typeof link> | null>();
    expect(plugin?.id).toBe('link');
    expect(f.auth.$ERROR_CODES.LINK_REVOCATION_FAILED).toMatchObject({
      code: 'LINK_REVOCATION_FAILED',
      message:
        'Unable to revoke Link access. The account remains connected; try again.',
    });
    expectTypeOf(
      f.client.$ERROR_CODES.LINK_REVOCATION_FAILED.code,
    ).toEqualTypeOf<'LINK_REVOCATION_FAILED'>();
  });

  it('starts the same Link connection through the server API', async () => {
    const f = await fixture();
    const result = await f.auth.api.connectLink({
      body: {
        callbackURL: '/settings',
        disableRedirect: true,
      },
      headers: {
        cookie: f.cookies.toString(),
        origin: 'http://localhost:3000',
      },
      returnHeaders: true,
    });

    expectTypeOf(f.auth.api.connectLink).toBeFunction();
    expect(result.response.redirect).toBe(false);
    expect(new URL(result.response.url).searchParams.get('client_id')).toBe(
      credentials.clientId,
    );
    const responseHeaders = result.headers ?? new Headers();
    expect(responseHeaders.getSetCookie().length).toBeGreaterThan(0);
    f.cookies.absorb(new Response(null, { headers: responseHeaders }));
    const callback = await f.complete(new URL(result.response.url));
    expect(callback.headers.get('location')).toBe('/settings');
  });

  it('connect forwards OAuth options and uses the existing client fetch configuration', async () => {
    const f = await fixture('database', '/custom/auth', {
      scopes: ['userinfo:read'],
    });
    const onSuccess = vi.fn();
    const result = await f.client.link.connect(
      {
        callbackURL: '/settings',
        errorCallbackURL: '/failed',
        disableRedirect: true,
        scopes: ['payment_methods.agentic'],
      },
      { onSuccess },
    );
    expect(result.error).toBeNull();
    expect(result.data?.redirect).toBe(false);
    expect(onSuccess).toHaveBeenCalledOnce();
    const url = new URL(result.data?.url ?? '');
    expect(url.searchParams.get('client_id')).toBe(credentials.clientId);
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['userinfo:read', 'payment_methods.agentic']),
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/custom/auth/callback/link',
    );
    expect((await f.complete(url)).headers.get('location')).toBe('/settings');
    expect(
      (await f.client.link.connect({ callbackURL: 'https://bad.example' }))
        .error?.status,
    ).toBe(403);
  });

  it('connect follows the configured client error handling', async () => {
    const data = { url: 'https://login.link.com/auth', redirect: false };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json(data));
    const client = createAuthClient({
      baseURL: 'http://localhost:3000',
      plugins: [linkClient()],
      fetchOptions: { throw: true, customFetchImpl: fetch },
    });
    const result = await client.link.connect();
    expectTypeOf(result).toEqualTypeOf<typeof data>();
    expect(result).toEqual(data);
    fetch.mockImplementation(async () =>
      Response.json(
        { code: 'UNAUTHORIZED', message: 'Unauthorized' },
        { status: 401 },
      ),
    );
    await expect(client.link.connect()).rejects.toMatchObject({ status: 401 });
  });

  it('connect requires an authenticated app user', async () => {
    const f = await fixture();
    await f.client.signOut();
    expect(
      (await f.client.link.connect({ callbackURL: '/settings' })).error,
    ).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(f.fetchMock).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'disconnect revokes before deleting with token encryption %s',
    async (encryptOAuthTokens) => {
      const f = await fixture(
        'database',
        '/custom/auth',
        {},
        { encryptOAuthTokens },
      );
      const account = await f.connect();
      f.fetchMock.mockImplementationOnce(async (input, init) => {
        expect(String(input)).toBe('https://login.link.com/auth/revoke');
        expect(init?.method).toBe('POST');
        expect(init?.redirect).toBe('error');
        expect(new Headers(init?.headers).get('authorization')).toBe(
          `Bearer ${credentials.publishableKey}`,
        );
        expect(new Headers(init?.headers).get('content-type')).toBe(
          'application/x-www-form-urlencoded',
        );
        expect(
          Object.fromEntries(new URLSearchParams(String(init?.body))),
        ).toEqual({
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          token: 'refresh-one',
          token_type_hint: 'refresh_token',
        });
        expect(
          f.database
            .prepare('select id from account where id = ?')
            .get(account.id),
        ).toBeDefined();
        return new Response(null, { status: 200 });
      });
      const result = await f.client.link.disconnect({ accountId: account.id });
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ status: true });
      expect(
        f.database
          .prepare('select id from account where id = ?')
          .get(account.id),
      ).toBeUndefined();
      expect((await f.client.listAccounts()).data).toEqual([
        expect.objectContaining({ providerId: 'credential' }),
      ]);
    },
  );

  it.each([400, 503, 'network'] as const)(
    'retains the account and credentials when revocation fails (%s)',
    async (failure) => {
      const f = await fixture();
      const account = await f.connect();
      const stored = f.database
        .prepare('select * from account where id = ?')
        .get(account.id);
      const sensitive = `refresh-one ${credentials.clientSecret}`;
      if (failure === 'network')
        f.fetchMock.mockRejectedValueOnce(new Error(sensitive));
      else
        f.fetchMock.mockResolvedValueOnce(
          new Response(sensitive, { status: failure }),
        );
      const result = await f.client.link.disconnect({ accountId: account.id });
      expect(result.error).toMatchObject({
        status: 502,
        code: 'LINK_REVOCATION_FAILED',
      });
      expect(JSON.stringify(result)).not.toContain('refresh-one');
      expect(JSON.stringify(result)).not.toContain(credentials.clientSecret);
      expect(
        f.database
          .prepare('select * from account where id = ?')
          .get(account.id),
      ).toEqual(stored);
      expect(
        (await f.client.link.disconnect({ accountId: account.id })).data,
      ).toEqual({ status: true });
    },
  );

  it('rejects another user’s account and non-Link accounts before revocation', async () => {
    const f = await fixture();
    const account = await f.connect();
    const ownPasswordAccount = (await f.client.listAccounts()).data?.find(
      (row) => row.providerId === 'credential',
    );
    if (!ownPasswordAccount) throw new Error('Expected a password account');
    const callCount = f.fetchMock.mock.calls.length;
    const passwordAccountResult = await f.client.link.disconnect({
      accountId: ownPasswordAccount.id,
    });
    expect(passwordAccountResult.error?.code).toBe('ACCOUNT_NOT_FOUND');
    const providerAccountResult = await f.client.link.disconnect({
      accountId: account.accountId,
    });
    expect(providerAccountResult.error?.code).toBe('ACCOUNT_NOT_FOUND');
    await f.signUp('another@example.com');
    const anotherUserResult = await f.client.link.disconnect({
      accountId: account.id,
    });
    expect(anotherUserResult.error?.code).toBe('ACCOUNT_NOT_FOUND');
    expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
    expect(
      f.database
        .prepare('select userId from account where id = ?')
        .get(account.id)?.userId,
    ).toBe(f.userId);
  });

  it('requires a fresh session before revocation', async () => {
    const f = await fixture();
    const account = await f.connect();
    const callCount = f.fetchMock.mock.calls.length;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60_000);
    expect(
      (await f.client.link.disconnect({ accountId: account.id })).error,
    ).toMatchObject({ status: 403, code: 'SESSION_NOT_FRESH' });
    expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
    expect(
      f.database.prepare('select id from account where id = ?').get(account.id),
    ).toBeDefined();
  });

  it('rejects a revoked session even when its cached cookie is still valid', async () => {
    const f = await fixture('database', '/api/auth', {}, { cookieCache: true });
    const account = await f.connect();
    const session = (await f.client.getSession()).data;
    if (!session) throw new Error('Expected an authenticated session');
    expect(session.user.id).toBe(f.userId);
    const ctx = await f.auth.$context;
    await ctx.internalAdapter.deleteSession(session.session.token);
    const callCount = f.fetchMock.mock.calls.length;
    expect(
      (await f.client.link.disconnect({ accountId: account.id })).error?.status,
    ).toBe(401);
    expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
    expect(
      f.database.prepare('select id from account where id = ?').get(account.id),
    ).toBeDefined();
  });

  it('revokes the latest rotated refresh token', async () => {
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
    expect(
      (await f.client.link.disconnect({ accountId: account.id })).data,
    ).toEqual({ status: true });
    const [url, init] = f.fetchMock.mock.lastCall ?? [];
    expect(String(url)).toBe('https://login.link.com/auth/revoke');
    expect(new URLSearchParams(String(init?.body)).get('token')).toBe(
      'refresh-two',
    );
  });

  it('rejects unauthenticated and cross-origin disconnects before revocation', async () => {
    const f = await fixture();
    const account = await f.connect();
    const callCount = f.fetchMock.mock.calls.length;
    const response = await f.auth.handler(
      new Request('http://localhost:3000/api/auth/link/disconnect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://bad.example',
          cookie: f.cookies.toString(),
        },
        body: JSON.stringify({ accountId: account.id }),
      }),
    );
    expect(response.status).toBe(403);
    await f.client.signOut();
    expect(
      (await f.client.link.disconnect({ accountId: account.id })).error?.status,
    ).toBe(401);
    expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
    expect(
      f.database.prepare('select id from account where id = ?').get(account.id),
    ).toBeDefined();
  });

  it('keeps the account when its refresh token is missing', async () => {
    const f = await fixture();
    const account = await f.connect();
    const ctx = await f.auth.$context;
    await ctx.internalAdapter.updateAccount(account.id, { refreshToken: null });
    const callCount = f.fetchMock.mock.calls.length;
    const result = await f.client.link.disconnect({ accountId: account.id });
    expect(result.error?.code).toBe('LINK_REFRESH_TOKEN_NOT_FOUND');
    expect(f.fetchMock).toHaveBeenCalledTimes(callCount);
    expect(
      f.database.prepare('select id from account where id = ?').get(account.id),
    ).toBeDefined();
  });

  it('honors the application’s explicit allowUnlinkingAll policy', async () => {
    const f = await fixture(
      'database',
      '/api/auth',
      {},
      { allowUnlinkingAll: true },
    );
    await f.client.signOut();
    await f.complete(await f.startSignIn());
    const account = (await f.client.listAccounts()).data?.[0];
    if (!account) throw new Error('Expected a Link account');
    expect(
      (await f.client.link.disconnect({ accountId: account.id })).data,
    ).toEqual({ status: true });
    expect(String(f.fetchMock.mock.lastCall?.[0])).toBe(
      'https://login.link.com/auth/revoke',
    );
    expect((await f.client.listAccounts()).data).toEqual([]);
  });
});

it('validates required credentials', () => {
  for (const field of ['clientId', 'clientSecret', 'publishableKey'] as const) {
    expect(() => link({ ...credentials, [field]: '' })).toThrow(
      `Link ${field} is required.`,
    );
  }
});
