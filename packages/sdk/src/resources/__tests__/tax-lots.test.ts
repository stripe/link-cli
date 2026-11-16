import { describe, expect, it, vi } from 'vitest';
import { getApiErrorDetails, LinkApiError, LinkResponseError } from '@/errors';
import { TaxLotsResource } from '@/resources/tax-lots';

const taxLot = {
  id: 'fclot_a',
  purchased_date: '2026-01-01',
  cost_basis: 12345,
  quantity: 0.125,
};

function resourceWithResponse(status: number, body: unknown) {
  const fetch = vi.fn().mockResolvedValue({
    status,
    statusText: '',
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  });
  return {
    fetch,
    resource: new TaxLotsResource({
      accessToken: 'test_token',
      fetch,
      apiBaseUrl: 'https://api.example.com',
    }),
  };
}

describe('TaxLotsResource', () => {
  it('requests one complete page with exact cursor and inclusive date-filter names', async () => {
    const page = {
      data: [{ ...taxLot, future: true }],
      has_more: true,
      page_metadata: 'kept',
    };
    const { fetch, resource } = resourceWithResponse(200, page);
    await expect(
      resource.list({
        holding: 'fchold_a',
        limit: 1,
        starting_after: 'fclot_before',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      }),
    ).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://api.example.com/tax_lots?holding=fchold_a&limit=1&starting_after=fclot_before&start_date=2026-01-01&end_date=2026-12-31',
    );
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(opts.body).toBeUndefined();
  });

  it('encodes the holding and backward cursor without supplying defaults', async () => {
    const { fetch, resource } = resourceWithResponse(200, {
      data: [],
      has_more: false,
    });
    await resource.list({
      holding: 'holding with&characters',
      ending_before: 'cursor &value',
    });
    expect([
      ...new URL(fetch.mock.calls[0]![0]).searchParams.entries(),
    ]).toEqual([
      ['holding', 'holding with&characters'],
      ['ending_before', 'cursor &value'],
    ]);
  });

  it.each([null, 0])(
    'preserves unknown and zero cost basis separately: %j',
    async (cost_basis) => {
      const page = { data: [{ ...taxLot, cost_basis }], has_more: false };
      const { resource } = resourceWithResponse(200, page);
      await expect(resource.list({ holding: 'fchold_a' })).resolves.toEqual(
        page,
      );
    },
  );

  it('returns an empty successful page', async () => {
    const page = { data: [], has_more: false };
    const { resource } = resourceWithResponse(200, page);
    await expect(resource.list({ holding: 'fchold_a' })).resolves.toEqual(page);
  });

  it.each(['id', 'purchased_date', 'cost_basis', 'quantity'])(
    'requires the reviewed %s field',
    async (field) => {
      const record: Record<string, unknown> = { ...taxLot };
      delete record[field];
      const { resource } = resourceWithResponse(200, {
        data: [record],
        has_more: false,
      });
      await expect(
        resource.list({ holding: 'fchold_a' }),
      ).rejects.toBeInstanceOf(LinkResponseError);
    },
  );

  it.each([
    { data: [taxLot] },
    { data: [{ ...taxLot, cost_basis: '12345' }], has_more: false },
    { data: [{ ...taxLot, quantity: null }], has_more: false },
  ])('rejects invalid page and amount shapes: %j', async (page) => {
    const { resource } = resourceWithResponse(200, page);
    await expect(resource.list({ holding: 'fchold_a' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('retains nested permission remediation without changing api_error', async () => {
    const details = {
      code: 'missing_permissions',
      message: 'Holdings access required',
      authorization_remediation: {
        authorization_details: [{ type: 'source', actions: ['read_holdings'] }],
      },
    };
    const { fetch, resource } = resourceWithResponse(403, { error: details });
    const error = await resource
      .list({ holding: 'fchold_a' })
      .catch((error) => error);
    expect(error).toBeInstanceOf(LinkApiError);
    expect(error).toMatchObject({ code: 'api_error', status: 403 });
    expect(getApiErrorDetails(error)).toEqual(details);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
