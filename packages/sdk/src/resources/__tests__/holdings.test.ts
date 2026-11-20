import { describe, expect, it, vi } from 'vitest';
import { getApiErrorDetails, LinkApiError, LinkResponseError } from '@/errors';
import { HoldingsResource } from '@/resources/holdings';

const holding = {
  id: 'fchold_a',
  source_id: 'csmrpd_a',
  description: 'Bitcoin',
  security_name: null,
  total_market_value: { usd: 12345 },
  quantity: 0.125,
  as_of_date: '2026-11-15',
  position_type: 'long',
  type: 'crypto',
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
    resource: new HoldingsResource({
      accessToken: 'test_token',
      fetch,
      apiBaseUrl: 'https://api.example.com',
    }),
  };
}

describe('HoldingsResource', () => {
  it('requests one full page with source and forward cursor, preserving future fields', async () => {
    const page = {
      data: [{ ...holding, ticker_symbol: 'BTC', extra: 'kept' }],
      has_more: true,
      page_metadata: 'kept',
    };
    const { fetch, resource } = resourceWithResponse(200, page);
    await expect(
      resource.list({
        source: 'csmrpd_a',
        limit: 1,
        starting_after: 'fchold_before',
      }),
    ).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://api.example.com/holdings?source=csmrpd_a&limit=1&starting_after=fchold_before',
    );
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(opts.body).toBeUndefined();
  });

  it('encodes the parent and backward cursor without adding defaults', async () => {
    const { fetch, resource } = resourceWithResponse(200, {
      data: [],
      has_more: false,
    });
    await resource.list({
      source: 'source with&characters',
      ending_before: 'cursor &value',
    });
    const url = new URL(fetch.mock.calls[0]![0]);
    expect([...url.searchParams.entries()]).toEqual([
      ['source', 'source with&characters'],
      ['ending_before', 'cursor &value'],
    ]);
  });

  it('returns an empty successful page', async () => {
    const page = { data: [], has_more: false };
    const { resource } = resourceWithResponse(200, page);
    await expect(resource.list({ source: 'csmrpd_a' })).resolves.toEqual(page);
  });

  it('accepts nullable snapshots, zero quantities and unknown type strings', async () => {
    const page = {
      data: [
        {
          ...holding,
          description: null,
          as_of_date: null,
          total_market_value: { usd: 0 },
          quantity: 0,
          type: 'future_type',
          position_type: 'future_position',
        },
      ],
      has_more: false,
    };
    const { resource } = resourceWithResponse(200, page);
    await expect(resource.list({ source: 'csmrpd_a' })).resolves.toEqual(page);
  });

  it('preserves null, omitted and string tickers across a full page', async () => {
    const page = {
      data: [
        {
          ...holding,
          id: 'fchold_cash',
          description: null,
          as_of_date: null,
          total_market_value: { usd: 200 },
          quantity: 200,
          type: 'cash',
          ticker_symbol: null,
        },
        { ...holding, id: 'fchold_without_ticker' },
        { ...holding, id: 'fchold_with_ticker', ticker_symbol: 'BTC' },
      ],
      has_more: true,
      page_metadata: 'kept',
    };
    const { fetch, resource } = resourceWithResponse(200, page);
    await expect(resource.list({ source: 'csmrpd_a' })).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    'id',
    'source_id',
    'description',
    'security_name',
    'total_market_value',
    'quantity',
    'as_of_date',
    'position_type',
    'type',
  ])('requires the reviewed %s field', async (field) => {
    const record: Record<string, unknown> = { ...holding };
    delete record[field];
    const { resource } = resourceWithResponse(200, {
      data: [record],
      has_more: false,
    });
    await expect(resource.list({ source: 'csmrpd_a' })).rejects.toBeInstanceOf(
      LinkResponseError,
    );
  });

  it.each([
    { data: [holding] },
    { data: [{ ...holding, quantity: '0.125' }], has_more: false },
    {
      data: [{ ...holding, total_market_value: { usd: null } }],
      has_more: false,
    },
  ])('rejects invalid page and amount shapes: %j', async (page) => {
    const { resource } = resourceWithResponse(200, page);
    await expect(resource.list({ source: 'csmrpd_a' })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('retains permission remediation and the existing SDK error code', async () => {
    const details = {
      code: 'missing_permissions',
      message: 'Holdings access required',
      authorization_remediation: {
        authorization_details: [{ type: 'source', actions: ['read_holdings'] }],
      },
    };
    const { fetch, resource } = resourceWithResponse(403, { error: details });
    const error = await resource
      .list({ source: 'csmrpd_a' })
      .catch((error) => error);
    expect(error).toBeInstanceOf(LinkApiError);
    expect(error).toMatchObject({ code: 'api_error', status: 403 });
    expect(getApiErrorDetails(error)).toEqual(details);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    'holdings_not_supported',
    'holdings_not_ready',
    'holdings_retrieval_failed',
  ])('preserves %s rather than returning an empty page', async (code) => {
    const { resource } = resourceWithResponse(409, { error: { code } });
    const error = await resource
      .list({ source: 'csmrpd_a' })
      .catch((error) => error);
    expect(getApiErrorDetails(error)).toEqual({ code });
    expect(error.message).toBe(`Failed to list holdings (409): ${code}`);
  });

  it('keeps non-JSON error handling outside the details accessor', async () => {
    const fetch = vi.fn().mockResolvedValue({
      status: 500,
      statusText: '',
      headers: new Headers(),
      text: async () => 'upstream payload',
    });
    const resource = new HoldingsResource({ accessToken: 'test_token', fetch });
    const error = await resource
      .list({ source: 'csmrpd_a' })
      .catch((error) => error);
    expect(error).toBeInstanceOf(LinkApiError);
    expect(error.message).toBe(
      'Failed to list holdings (500): upstream payload',
    );
    expect(getApiErrorDetails(error)).toBeNull();
  });
});
