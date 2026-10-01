import { LinkApiError } from '@stripe/link-sdk';
import { linkToolSchemas } from '@stripe/link-sdk/tools';
import { ConnectionAuthorizationRequiredError } from 'eve/connections';
import type { ToolAuthProvider, ToolContext } from 'eve/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createSpendRequest from '../extension/tools/create_spend_request';
import listPaymentMethods from '../extension/tools/list_payment_methods';

const settings = vi.hoisted(() => ({
  config: { accessToken: 'configured-token' } as
    | { accessToken: string }
    | { auth: ToolAuthProvider },
}));
vi.mock('../extension/extension', () => ({ default: settings }));

beforeEach(() => {
  settings.config = { accessToken: 'configured-token' };
});

function context(): ToolContext {
  return {
    session: {
      id: 'session-one',
      auth: { current: null, initiator: null },
      turn: { id: 'turn-one', sequence: 1 },
    },
    callId: 'call-one',
    toolName: 'link__create_spend_request',
    abortSignal: new AbortController().signal,
    getSandbox: vi.fn(),
    getToken: vi.fn(),
    requireAuth: () => {
      throw new Error('Unexpected auth');
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Eve spend approval', () => {
  it.each([undefined, true, false])(
    'requires approval on every call with request_approval=%s',
    async (requestApproval) => {
      const approval = createSpendRequest.approval;
      if (typeof approval !== 'function') {
        throw new Error('Expected a spend-request approval policy');
      }
      for (const approvedTools of [
        new Set<string>(),
        new Set(['link__create_spend_request']),
      ]) {
        expect(
          await approval({
            ...context(),
            approvedTools,
            toolInput: linkToolSchemas.createSpendRequest.parse({
              amount: 1000,
              merchant_name: 'Example',
              merchant_url: 'https://example.com',
              context:
                'A user-requested purchase with shipping and tax. '.repeat(3),
              ...(requestApproval === undefined
                ? {}
                : { request_approval: requestApproval }),
            }),
          }),
        ).toBe('user-approval');
      }
    },
  );
});

describe('Eve access token', () => {
  it('uses the configured token without requiring a user principal', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => Response.json({ payment_details: [] }));
    vi.stubGlobal('fetch', fetch);
    const ctx = context();
    expect(await listPaymentMethods.execute({}, ctx)).toEqual([]);
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer configured-token');
    expect(ctx.getToken).not.toHaveBeenCalled();
  });

  it('fails once on 401 without refreshing or exposing the rejected token', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({ error: 'rejected configured-token' }, { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(listPaymentMethods.execute({}, context())).rejects.toThrow(
      /^Link access token is invalid or expired\. Configure a new accessToken for the extension\.$/,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves non-authentication SDK errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ error: 'unavailable' }, { status: 503 }),
        ),
    );
    await expect(
      listPaymentMethods.execute({}, context()),
    ).rejects.toBeInstanceOf(LinkApiError);
  });
});

describe('Eve authorization provider', () => {
  it('uses the current caller’s token on each execution', async () => {
    const auth = { getToken: vi.fn() };
    settings.config = { auth };
    const fetch = vi
      .fn()
      .mockImplementation(async () => Response.json({ payment_details: [] }));
    vi.stubGlobal('fetch', fetch);
    for (const token of ['alice-token', 'bob-token']) {
      const ctx = {
        ...context(),
        getToken: vi.fn().mockResolvedValue({ token }),
      };
      expect(await listPaymentMethods.execute({}, ctx)).toEqual([]);
      expect(ctx.getToken).toHaveBeenCalledWith(auth);
      expect(
        new Headers(fetch.mock.lastCall?.[1]?.headers).get('authorization'),
      ).toBe(`Bearer ${token}`);
    }
    expect(auth.getToken).not.toHaveBeenCalled();
  });

  it('lets Eve suspend the tool before making a Link request', async () => {
    const auth = { getToken: vi.fn() };
    settings.config = { auth };
    const required = new ConnectionAuthorizationRequiredError('link');
    const ctx = { ...context(), getToken: vi.fn().mockRejectedValue(required) };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(listPaymentMethods.execute({}, ctx)).rejects.toBe(required);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('invalidates a rejected OAuth token through Eve without retrying the API call', async () => {
    const auth = { getToken: vi.fn() };
    settings.config = { auth };
    const required = new ConnectionAuthorizationRequiredError('link');
    const requireAuth = vi.fn(() => {
      throw required;
    });
    const ctx = {
      ...context(),
      getToken: vi.fn().mockResolvedValue({ token: 'rejected-token' }),
      requireAuth,
    };
    const fetch = vi
      .fn()
      .mockImplementation(async () =>
        Response.json({ error: 'rejected-token' }, { status: 401 }),
      );
    vi.stubGlobal('fetch', fetch);
    await expect(listPaymentMethods.execute({}, ctx)).rejects.toBe(required);
    expect(requireAuth).toHaveBeenCalledWith(auth);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
