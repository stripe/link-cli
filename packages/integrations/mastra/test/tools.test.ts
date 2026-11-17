import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { validateSkillContent } from '@mastra/core/skills';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { isValidationError, Tool } from '@mastra/core/tools';
import { LinkApiError, type SpendRequest } from '@stripe/link-sdk';
import { createLinkTools as createSdkTools } from '@stripe/link-sdk/tools';
import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import { createLinkTools, type LinkToolsOptions, linkSkillsPath } from '../src';
import { execute, purchase, spendRequest, streamingModel } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

it('registers the complete SDK catalog as native tools without resolving credentials', async () => {
  const getAccessToken = vi.fn(() => 'unused');
  const tools = createLinkTools({ getAccessToken });
  const sdk = createSdkTools(() => {
    throw new Error('Unexpected client lookup');
  });
  expect(Object.keys(tools)).toEqual(Object.keys(sdk));
  for (const name of Object.keys(tools) as (keyof typeof tools)[]) {
    expect(tools[name]).toBeInstanceOf(Tool);
    expect(tools[name].id).toBe(name);
    expect(tools[name].description).toBe(sdk[name].description);
    expect(tools[name].inputSchema).toBeDefined();
    expect(tools[name].requireApproval).toBe(name === 'create_spend_request');
  }
  const agent = new Agent({
    id: 'discovery',
    name: 'Discovery',
    instructions: 'Help with the Link wallet.',
    model: streamingModel(new MastraLanguageModelV2Mock({})),
    tools,
    skills: [linkSkillsPath],
  });
  expect(Object.keys(await agent.listTools())).toEqual(Object.keys(tools));
  expect((await agent.listSkills()).map((skill) => skill.name)).toEqual([
    'create-payment-credential',
    'financial-insights',
  ]);
  expect(getAccessToken).not.toHaveBeenCalled();
});

it.each(['create-payment-credential', 'financial-insights'])(
  'ships a valid %s skill that references only native tools',
  async (name) => {
    const content = await readFile(
      join(linkSkillsPath, name, 'SKILL.md'),
      'utf8',
    );
    expect(
      validateSkillContent({ content, directoryName: name }),
    ).toMatchObject({
      valid: true,
    });
    const tools = createLinkTools({ accessToken: 'unused' });
    // Input fields and resolution values share tool-name prefixes.
    const notTools = new Set([
      'request_approval',
      'create_new_spend_request',
      'create_new_spend_request_after_completion',
    ]);
    const referenced = new Set(
      content.match(
        /\b(?:cancel|create|list|request|retrieve|update)_[a-z_]+\b/g,
      ),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      if (!notTools.has(name)) expect(Object.keys(tools)).toContain(name);
    }
  },
);

it.each([
  {},
  { accessToken: '' },
  { accessToken: ' ' },
  { getAccessToken: 'token' },
  { accessToken: 'token', getAccessToken: () => 'other' },
])('rejects invalid configuration %j', (options) => {
  expect(() => createLinkTools(options as LinkToolsOptions)).toThrow();
});

it('uses a static token without a user identity', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json({ payment_details: [] }));
  vi.stubGlobal('fetch', fetch);
  const tools = createLinkTools({ accessToken: ' configured-token ' });
  expect(await execute(tools.list_payment_methods, {})).toEqual([]);
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization'),
  ).toBe('Bearer configured-token');
});

it('resolves fresh tokens for concurrent callers and subsequent calls', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json({ payment_details: [] }));
  vi.stubGlobal('fetch', fetch);
  const getAccessToken = vi.fn(async (context) => {
    await Promise.resolve();
    return context.requestContext.get('token');
  });
  const tools = createLinkTools({ getAccessToken });
  const contexts = ['alice', 'bob'].map(
    (token) => new RequestContext<unknown>([['token', token]]),
  );
  await Promise.all(
    contexts.map((ctx) => execute(tools.list_payment_methods, {}, ctx)),
  );
  const alice = contexts[0];
  if (!alice) throw new Error('Missing context');
  alice.set('token', 'alice-refreshed');
  await execute(tools.list_payment_methods, {}, alice);
  expect(getAccessToken).toHaveBeenCalledTimes(3);
  expect(
    fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('authorization'),
    ),
  ).toEqual(['Bearer alice', 'Bearer bob', 'Bearer alice-refreshed']);
});

it('stops before the API call when token lookup fails or returns an empty token', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const failure = new Error('Reconnect Link in the application');
  const tools = createLinkTools({
    getAccessToken: () => {
      throw failure;
    },
  });
  await expect(execute(tools.list_payment_methods, {})).rejects.toBe(failure);
  for (const token of ['', ' ']) {
    const tools = createLinkTools({ getAccessToken: async () => token });
    await expect(execute(tools.list_payment_methods, {})).rejects.toThrow(
      'nonempty Link access token',
    );
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('validates inputs before looking up credentials', async () => {
  const getAccessToken = vi.fn(() => 'unused');
  const tools = createLinkTools({ getAccessToken });
  expect(
    isValidationError(
      await execute(tools.create_spend_request, { ...purchase, amount: -1 }),
    ),
  ).toBe(true);
  expect(
    isValidationError(
      await execute(tools.list_payment_methods, {
        accessToken: 'model-supplied',
      } as never),
    ),
  ).toBe(true);
  expect(getAccessToken).not.toHaveBeenCalled();
});

it('keeps SDK input defaults, API mapping, responses, and static types', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(spendRequest));
  vi.stubGlobal('fetch', fetch);
  const tools = createLinkTools({ accessToken: 'token' });
  const result = await execute(tools.create_spend_request, {
    ...purchase,
    idempotency_key: 'one',
    line_items: [{ name: 'Book', description: undefined }],
  });
  expectTypeOf(result).extract<SpendRequest>().toEqualTypeOf<SpendRequest>();
  expect(result).toEqual(spendRequest);
  expect(fetch.mock.calls[0]?.[0]).toBe('https://api.link.com/spend_requests');
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    ...purchase,
    idempotency_key: 'one',
    credential_type: 'card',
    request_approval: true,
    test: false,
    line_items: [{ name: 'Book' }],
  });
  await execute(tools.retrieve_spend_request, {
    id: 'lsrq_one',
    include: ['card'],
  });
  expect(String(fetch.mock.calls[1]?.[0])).toContain(
    '/spend_requests/lsrq_one?include=card',
  );
});

it.each(['static', 'resolver'])(
  'sanitizes 401 responses without retrying in %s mode',
  async (mode) => {
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ error: 'rejected-secret-token' }, { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    const tools = createLinkTools(
      mode === 'static'
        ? { accessToken: 'rejected-secret-token' }
        : { getAccessToken: () => 'rejected-secret-token' },
    );
    await expect(execute(tools.list_payment_methods, {})).rejects.toThrow(
      /^Link access token is invalid or expired\. Configure a new accessToken or have getAccessToken return a valid token\.$/,
    );
    expect(fetch).toHaveBeenCalledOnce();
  },
);

it('preserves non-authentication SDK errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ error: 'unavailable' }, { status: 503 }),
      ),
  );
  const tools = createLinkTools({ accessToken: 'token' });
  await expect(execute(tools.list_payment_methods, {})).rejects.toBeInstanceOf(
    LinkApiError,
  );
});

it('preserves insight permissions as data and uses the SDK query schema', async () => {
  const page = {
    data: [
      {
        id: 'top-brand',
        description: 'Top brands',
        status: 'no_data',
        error_code: 'missing_permissions',
        authorization_remediation: { scope: ['transactions'] },
        data: [],
      },
    ],
    has_more: false,
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(page));
  vi.stubGlobal('fetch', fetch);
  const getAccessToken = vi.fn(() => 'user-token');
  const tools = createLinkTools({ getAccessToken });
  expect(await execute(tools.list_available_insight_types, {})).toEqual(page);
  expect(
    await execute(tools.list_insights, { insights: ['top-brand'] }),
  ).toEqual(page);
  const urls = fetch.mock.calls.map(([url]) => new URL(String(url)));
  expect(urls.map((url) => url.pathname)).toEqual([
    '/insights/available_types',
    '/insights',
  ]);
  expect(urls[1]?.searchParams.getAll('insights[]')).toEqual(['top-brand']);
  expect(getAccessToken).toHaveBeenCalledTimes(2);
});
