import { LinkApiError } from '@/errors';
import { UcpResource } from '@/resources/ucp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    statusText: '',
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  });
}

describe('UcpResource', () => {
  let repo: UcpResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    vi.stubEnv('LINK_API_BASE_URL', undefined);
    getAccessToken.mockResolvedValue('test_token');
    repo = new UcpResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('searchCatalog', () => {
    it('GETs the search endpoint with query, array filters, and bearer auth', async () => {
      mockFetchResponse(200, {
        object: 'delegated_commerce.keyword_search_result',
        data: [{ sku_id: 'sku_1', name: 'Sneaker' }],
        total_count: 1,
        has_more: false,
        took_ms: 12,
      });

      const result = await repo.searchCatalog({
        query: 'sneakers',
        brand: ['acme', 'beta'],
        limit: 5,
        include_facets: true,
        test: true,
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/ucp/catalog/search');
      expect(parsed.searchParams.get('query')).toBe('sneakers');
      expect(parsed.searchParams.getAll('brand[]')).toEqual(['acme', 'beta']);
      expect(parsed.searchParams.get('limit')).toBe('5');
      expect(parsed.searchParams.get('include_facets')).toBe('true');
      expect(parsed.searchParams.get('test')).toBe('true');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toBe('Bearer test_token');

      expect(result.data[0]!.sku_id).toBe('sku_1');
      expect(result.total_count).toBe(1);
    });

    it('defaults data to an empty array when the body omits it', async () => {
      mockFetchResponse(200, { total_count: 0 });

      const result = await repo.searchCatalog({ query: 'nothing' });

      expect(result.data).toEqual([]);
    });

    it('throws a LinkApiError with the server message on non-2xx', async () => {
      mockFetchResponse(400, {
        error: {
          code: 'parameter_invalid_empty',
          message: 'query is required',
        },
      });

      await expect(repo.searchCatalog({ query: 'x' })).rejects.toThrow(
        'Failed to search UCP catalog (400): query is required',
      );
    });
  });

  describe('createCheckout', () => {
    it('POSTs profile_id and line_items and returns the session', async () => {
      mockFetchResponse(200, {
        id: 'dcs_1',
        status: 'requires_payment',
        amount_total: 5500,
      });

      const result = await repo.createCheckout({
        profile_id: 'np_1',
        line_items: [{ sku_id: 'sku_1', quantity: 2 }],
        currency: 'usd',
        test: true,
      });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/ucp/checkout');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(opts.body);
      expect(body.profile_id).toBe('np_1');
      expect(body.line_items).toEqual([{ sku_id: 'sku_1', quantity: 2 }]);
      expect(body.currency).toBe('usd');
      expect(body.test).toBe(true);

      expect(result.id).toBe('dcs_1');
      expect(result.amount_total).toBe(5500);
    });

    it('omits fulfillment_details and test when not provided', async () => {
      mockFetchResponse(200, { id: 'dcs_1' });

      await repo.createCheckout({
        profile_id: 'np_1',
        line_items: [{ sku_id: 'sku_1', quantity: 1 }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body).not.toHaveProperty('fulfillment_details');
      expect(body).not.toHaveProperty('test');
    });

    it('throws on non-2xx', async () => {
      mockFetchResponse(400, { error: { message: 'No such sku' } });

      await expect(
        repo.createCheckout({
          profile_id: 'np_1',
          line_items: [{ sku_id: 'bad', quantity: 1 }],
        }),
      ).rejects.toThrow('Failed to create UCP checkout (400): No such sku');
    });
  });

  describe('completeCheckout', () => {
    it('POSTs the spend request and profile IDs to the confirm path', async () => {
      mockFetchResponse(200, {
        id: 'dcs_1',
        status: 'completed',
        order_details: { status: 'confirmed' },
      });

      const result = await repo.completeCheckout('dcs_1', {
        spend_request_id: 'lsrq_1',
        profile_id: 'np_1',
        test: true,
      });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/ucp/checkout/dcs_1/complete');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({
        spend_request_id: 'lsrq_1',
        profile_id: 'np_1',
        test: true,
      });

      expect(result.status).toBe('completed');
    });

    it('URL-encodes the checkout id in the path', async () => {
      mockFetchResponse(200, { id: 'dcs/weird' });

      await repo.completeCheckout('dcs/weird', {
        spend_request_id: 'lsrq_1',
        profile_id: 'np_1',
      });

      expect(mockFetch.mock.calls[0]![0]).toBe(
        'https://api.link.com/ucp/checkout/dcs%2Fweird/complete',
      );
    });

    it('surfaces an upstream card error via LinkApiError', async () => {
      mockFetchResponse(402, {
        error: { code: 'card_declined', message: 'Your card was declined.' },
      });

      await expect(
        repo.completeCheckout('dcs_1', {
          spend_request_id: 'lsrq_1',
          profile_id: 'np_1',
        }),
      ).rejects.toThrow(
        'Failed to complete UCP checkout (402): Your card was declined.',
      );
    });
  });

  it('retries once on 401 after refreshing the token', async () => {
    getAccessToken.mockResolvedValueOnce('stale_token');
    getAccessToken.mockResolvedValueOnce('fresh_token');
    mockFetch
      .mockResolvedValueOnce({
        status: 401,
        statusText: '',
        headers: new Headers(),
        text: async () => '{}',
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: '',
        headers: new Headers(),
        text: async () => JSON.stringify({ data: [], total_count: 0 }),
      });

    await repo.searchCatalog({ query: 'sneakers' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
    expect(getAccessToken).toHaveBeenCalledWith({ forceRefresh: true });
  });
});
