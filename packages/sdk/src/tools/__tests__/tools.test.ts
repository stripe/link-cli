import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Link } from '../../client';
import { createLinkTools, linkToolSchemas } from '../index';

function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () =>
    Response.json({
      id: 'lsrq_one',
      status: 'pending_approval',
      created_at: '2026-09-17',
      updated_at: '2026-09-17',
      approval_url: 'https://link.com/approve/one',
    }),
  );
  const getClient = vi.fn(
    ({ userId }: { userId: string }) =>
      new Link({ accessToken: userId, fetch }),
  );
  return { fetch, getClient, tools: createLinkTools(getClient) };
}
const context = { userId: 'alice' };
const purchase = {
  amount: 1000,
  merchant_name: 'Example',
  merchant_url: 'https://example.com',
  context:
    'A user-requested purchase of a book from Example. The total includes shipping and taxes and is within the requested budget.',
};

describe('Link tools', () => {
  it('exposes JSON-Schema-compatible inputs without resolving credentials', () => {
    const { tools, getClient } = fixture();
    for (const tool of Object.values(tools)) {
      expect(z.toJSONSchema(tool.inputSchema).type).toBe('object');
      expect(tool.description).not.toBe('');
    }
    expect(getClient).not.toHaveBeenCalled();
  });

  it('resolves a fresh client for each caller of a shared tool', async () => {
    const { tools, getClient, fetch } = fixture();
    fetch.mockImplementation(async () =>
      Response.json({ payment_details: [] }),
    );
    await Promise.all([
      tools.list_payment_methods.execute({}, { userId: 'alice' }),
      tools.list_payment_methods.execute({}, { userId: 'bob' }),
    ]);
    expect(getClient.mock.calls).toEqual([
      [{ userId: 'alice' }],
      [{ userId: 'bob' }],
    ]);
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('authorization'),
      ),
    ).toEqual(['Bearer alice', 'Bearer bob']);
  });

  it('rejects invalid and auth-bearing inputs before token lookup', async () => {
    const { tools, getClient } = fixture();
    await expect(
      tools.create_spend_request.execute({ ...purchase, amount: -1 }, context),
    ).rejects.toThrow();
    await expect(
      tools.list_payment_methods.execute({ userId: 'bob' } as never, context),
    ).rejects.toThrow();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('creates through the SDK with API field names and approval defaults', async () => {
    const { tools, fetch } = fixture();
    const result = await tools.create_spend_request.execute(
      {
        ...purchase,
        idempotency_key: 'same-purchase',
        line_items: [{ name: 'Book', quantity: 1, description: undefined }],
      },
      context,
    );
    expect(result.approval_url).toBe('https://link.com/approve/one');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/spend_requests');
    expect(JSON.parse(String(init?.body))).toEqual({
      ...purchase,
      idempotency_key: 'same-purchase',
      credential_type: 'card',
      currency: 'usd',
      request_approval: true,
      test: false,
      line_items: [{ name: 'Book', quantity: 1 }],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('enforces Link Pay Token targeting without exposing delegated approval', () => {
    expect(
      linkToolSchemas.createSpendRequest.safeParse({
        ...purchase,
        execution_method: 'link_pay_token',
        merchant_account_id: 'acct_one',
      }).success,
    ).toBe(false);
    expect(
      linkToolSchemas.createSpendRequest.safeParse({
        amount: 1000,
        context: purchase.context,
        execution_method: 'link_pay_token',
        merchant_account_id: 'acct_one',
      }).success,
    ).toBe(true);
    expect(
      linkToolSchemas.createSpendRequest.safeParse({
        ...purchase,
        approval_details: { approval_method: 'programmatic' },
      }).success,
    ).toBe(false);
    expect(
      linkToolSchemas.updateSpendRequest.safeParse({
        id: 'lsrq_one',
        execution_method: 'link_pay_token',
      }).success,
    ).toBe(false);
  });

  it('maps retrieve includes and update IDs without putting IDs in the body', async () => {
    const { tools, fetch } = fixture();
    await tools.retrieve_spend_request.execute(
      { id: 'lsrq_one', include: ['card'] },
      context,
    );
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      '/spend_requests/lsrq_one?include=card',
    );
    await tools.update_spend_request.execute(
      {
        id: 'lsrq_one',
        amount: 2000,
        line_items: [{ name: 'Book', quantity: 2 }],
      },
      context,
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      'https://api.link.com/spend_requests/lsrq_one',
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      amount: 2000,
      line_items: [{ name: 'Book', quantity: 2 }],
    });
  });

  it('keeps reports with long attempt traces valid', () => {
    expect(
      linkToolSchemas.createReport.safeParse({
        domain: 'example.com',
        outcome: 'blocked',
        spend_request_id: 'lsrq_one',
        attempt_trace: 'x'.repeat(9000),
      }).success,
    ).toBe(true);
  });

  it('accepts a preconfigured SDK client', async () => {
    const client = new Link({ accessToken: 'token' });
    const retrieve = vi.spyOn(client.userInfo, 'retrieve').mockResolvedValue({
      email: null,
      name: null,
      first_name: null,
      last_name: null,
      phone: null,
    });
    await createLinkTools(client).retrieve_user_info.execute({}, undefined);
    expect(retrieve).toHaveBeenCalledOnce();
  });
});
