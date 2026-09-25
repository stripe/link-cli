import { LinkApiError } from '@stripe/link-sdk';
import { linkToolSchemas } from '@stripe/link-sdk/tools';
import type { ToolContext } from 'eve/tools';
import { afterEach, describe, expect, it, vi } from 'vitest';
import createSpendRequest from '../extension/tools/create_spend_request';
import listPaymentMethods from '../extension/tools/list_payment_methods';

vi.mock('../extension/extension', () => ({
  default: { config: { accessToken: 'configured-token' } },
}));

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
    getSkill: vi.fn(),
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
