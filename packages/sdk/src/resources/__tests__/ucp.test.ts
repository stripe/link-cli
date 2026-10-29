import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UcpResource } from '@/resources/ucp';

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
    vi.resetAllMocks();
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
        business: 'np_1',
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
      expect(parsed.searchParams.get('business')).toBe('np_1');
      expect(parsed.searchParams.has('profile_id')).toBe(false);
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

  describe('checkout requests', () => {
    const fulfillment = {
      methods: [
        {
          type: 'shipping',
          destinations: [
            { street_address: '123 Main St', address_country: 'US' },
          ],
          groups: [{ id: 'group_1', selected_option_id: 'express' }],
        },
      ],
    };

    it.each(['create', 'update'] as const)(
      '%s sends the UCP state and preserves the complete response',
      async (operation) => {
        const checkout = {
          id: 'checkout/1',
          status: 'ready_for_complete',
          currency: 'usd',
          totals: [{ type: 'total', amount: 5500 }],
          fulfillment,
          ucp: { version: '2026-01-23' },
        };
        mockFetchResponse(200, checkout);
        const params = {
          business: 'np_1',
          line_items: [{ item: { id: 'sku_1' } }],
          buyer: { email: 'jane@example.com', phone_number: '+1234567890' },
          fulfillment,
        };
        const result =
          operation === 'create'
            ? await repo.createCheckout(params)
            : await repo.updateCheckout('checkout/1', params);
        const [url, opts] = mockFetch.mock.calls[0]!;
        expect(url).toBe(
          operation === 'create'
            ? 'https://api.link.com/ucp/checkout'
            : 'https://api.link.com/ucp/checkout/checkout%2F1',
        );
        expect(opts.method).toBe(operation === 'create' ? 'POST' : 'PUT');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(opts.body)).toEqual({
          ...params,
          line_items: [{ item: { id: 'sku_1' }, quantity: 1 }],
        });
        expect(result).toEqual(checkout);
      },
    );

    it('omits optional sections instead of applying update defaults', async () => {
      mockFetchResponse(200, { id: 'checkout_1' });
      await repo.updateCheckout('checkout_1', {
        business: 'np_1',
        line_items: [
          {
            id: 'line_1',
            parent_id: 'parent_1',
            item: { id: 'sku_1' },
            quantity: 2,
          },
        ],
      });
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({
        business: 'np_1',
        line_items: [
          {
            id: 'line_1',
            parent_id: 'parent_1',
            item: { id: 'sku_1' },
            quantity: 2,
          },
        ],
      });
    });

    it.each(['create', 'update'] as const)(
      'surfaces %s errors',
      async (operation) => {
        mockFetchResponse(400, { error: { message: 'No such sku' } });
        const params = {
          business: 'np_1',
          line_items: [{ item: { id: 'bad' }, quantity: 1 }],
        };
        await expect(
          operation === 'create'
            ? repo.createCheckout(params)
            : repo.updateCheckout('checkout_1', params),
        ).rejects.toThrow(
          `Failed to ${operation} UCP checkout (400): No such sku`,
        );
      },
    );
  });

  describe('completeCheckout', () => {
    it('POSTs only business and spend request IDs to the encoded completion path', async () => {
      mockFetchResponse(200, {
        id: 'checkout/1',
        status: 'completed',
        order: { id: 'order_1' },
      });
      const result = await repo.completeCheckout('checkout/1', {
        spend_request_id: 'lsrq_1',
        business: 'np_1',
      });
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        'https://api.link.com/ucp/checkout/checkout%2F1/complete',
      );
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({
        spend_request_id: 'lsrq_1',
        business: 'np_1',
      });
      expect(result.status).toBe('completed');
      expect(result.order).toEqual({ id: 'order_1' });
    });

    it('surfaces an upstream card error via LinkApiError', async () => {
      mockFetchResponse(402, {
        error: { code: 'card_declined', message: 'Your card was declined.' },
      });
      await expect(
        repo.completeCheckout('checkout_1', {
          spend_request_id: 'lsrq_1',
          business: 'np_1',
        }),
      ).rejects.toThrow(
        'Failed to complete UCP checkout (402): Your card was declined.',
      );
    });
  });

  describe('retrieveCheckout', () => {
    it('retrieves a checkout before payment using only business', async () => {
      const checkout = {
        id: 'checkout/1',
        status: 'incomplete',
        messages: [{ code: 'missing_fulfillment' }],
      };
      mockFetchResponse(200, checkout);
      const result = await repo.retrieveCheckout('checkout/1', {
        business: 'np_1',
      });
      expect(mockFetch).toHaveBeenCalledOnce();
      const [rawUrl, opts] = mockFetch.mock.calls[0]!;
      const url = new URL(rawUrl);
      expect(url.pathname).toBe('/ucp/checkout/checkout%2F1');
      expect([...url.searchParams]).toEqual([['business', 'np_1']]);
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
      expect(result).toEqual(checkout);
    });

    it('attaches separately retrieved payment state using the configured spend endpoint', async () => {
      repo = new UcpResource({
        getAccessToken,
        spendRequestBaseUrl: 'https://spend.example.com',
      });
      const spendRequest = {
        id: 'lsrq_1',
        status: 'requires_action',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:01Z',
        status_details: {
          requires_action: { next_action: { resolution: 'auto_resume' } },
        },
      };
      mockFetch.mockImplementation(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes('/spend_requests/')
                ? spendRequest
                : { id: 'checkout_1', status: 'completed' },
            ),
            { status: 200 },
          ),
      );
      const result = await repo.retrieveCheckout('checkout_1', {
        business: 'np_1',
        spend_request_id: 'lsrq_1',
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]![0]).toBe(
        'https://api.link.com/ucp/checkout/checkout_1?business=np_1',
      );
      expect(mockFetch.mock.calls[1]![0]).toBe(
        'https://spend.example.com/spend_requests/lsrq_1',
      );
      expect(result.spend_request).toEqual(spendRequest);
    });

    it('fails when the associated spend request is missing', async () => {
      mockFetch.mockImplementation(
        async (url: string) =>
          new Response(JSON.stringify({ id: 'checkout_1' }), {
            status: url.includes('/spend_requests/') ? 404 : 200,
          }),
      );
      await expect(
        repo.retrieveCheckout('checkout_1', {
          business: 'np_1',
          spend_request_id: 'missing',
        }),
      ).rejects.toThrow('Associated spend request not found');
    });

    it.each([400, 429, 502])(
      'propagates a structured LinkApiError for %s',
      async (status) => {
        const details = {
          error: { code: 'upstream_error', message: 'retrieval failed' },
        };
        mockFetchResponse(status, details);
        await expect(
          repo.retrieveCheckout('checkout_1', { business: 'np_1' }),
        ).rejects.toMatchObject({ status, details });
        expect(mockFetch).toHaveBeenCalledOnce();
      },
    );
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
