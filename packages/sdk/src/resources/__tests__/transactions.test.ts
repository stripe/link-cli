import { TransactionsResource } from '@/resources/transactions';
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

describe('TransactionsResource', () => {
  let repo: TransactionsResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    vi.stubEnv('LINK_API_BASE_URL', undefined);
    getAccessToken.mockResolvedValue('test_token');
    repo = new TransactionsResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('GETs the Link API transactions endpoint with bearer auth', async () => {
    mockFetchResponse(200, {
      data: [
        {
          id: 'lbctxn_123',
          source_id: null,
          amount: -979,
          currency: 'usd',
          created_date: '2026-06-08',
          description: 'Chase',
          origin: 'external_connection',
          category: 'credit_card_payment',
          status: 'succeeded',
        },
      ],
      has_more: true,
    });

    const result = await repo.list();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/transactions');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');

    expect(result).toEqual({
      data: [
        {
          id: 'lbctxn_123',
          source_id: null,
          amount: -979,
          currency: 'usd',
          created_date: '2026-06-08',
          description: 'Chase',
          origin: 'external_connection',
          category: 'credit_card_payment',
          status: 'succeeded',
        },
      ],
      has_more: true,
    });
  });

  it('encodes optional list params in the query string', async () => {
    mockFetchResponse(200, { data: [] });

    await repo.list({
      limit: 50,
      starting_after: 'cursor_a',
      ending_before: 'cursor_b',
      start_date: '2026-06-08',
      end_date: '2026-06-09',
      category: 'shopping',
      origin: 'link',
      sources: ['csmrpd_a', 'csmrpd_b'],
    });

    const url = new URL(mockFetch.mock.calls[0]![0]);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('starting_after')).toBe('cursor_a');
    expect(url.searchParams.get('ending_before')).toBe('cursor_b');
    expect(url.searchParams.get('date_start')).toBe('2026-06-08');
    expect(url.searchParams.get('date_end')).toBe('2026-06-09');
    expect(url.searchParams.get('category')).toBe('shopping');
    expect(url.searchParams.get('origin')).toBe('link');
    expect(url.searchParams.getAll('sources[]')).toEqual([
      'csmrpd_a',
      'csmrpd_b',
    ]);
    expect(url.searchParams.has('start_date')).toBe(false);
    expect(url.searchParams.has('end_date')).toBe(false);
    expect(url.searchParams.has('transaction_category')).toBe(false);
  });

  it('uses an explicitly configured base URL', async () => {
    repo = new TransactionsResource({
      getAccessToken,
      apiBaseUrl: 'https://api.qa.link.com',
    });
    mockFetchResponse(200, { data: [] });

    await repo.list();

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'https://api.qa.link.com/transactions',
    );
  });

  it('refreshes the token and retries once on 401', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 401,
        statusText: '',
        headers: new Headers(),
        text: async () => JSON.stringify({ error: 'expired_token' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: '',
        headers: new Headers(),
        text: async () => JSON.stringify({ data: [] }),
      });
    getAccessToken
      .mockResolvedValueOnce('test_token')
      .mockResolvedValueOnce('fresh_token');

    const result = await repo.list();

    expect(result).toEqual({ data: [] });
    expect(getAccessToken).toHaveBeenNthCalledWith(1);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(500, { message: 'boom' });

    await expect(repo.list()).rejects.toThrow(
      'Failed to list transactions (500): boom',
    );
  });

  it('throws when no access token is available', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

    await expect(repo.list()).rejects.toThrow('Missing access token');
  });

  it('throws when the response shape is invalid', async () => {
    mockFetchResponse(200, { data: [{ id: 'lbctxn_123' }] });

    await expect(repo.list()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });

  describe('update', () => {
    const bareTransaction = {
      id: 'lbctxn_123',
      source_id: null,
      amount: -979,
      currency: 'usd',
      created_date: '2026-06-08',
      description: 'Trader Joes',
      origin: 'external_connection',
      category: 'groceries',
      status: 'succeeded',
    };

    it('POSTs the update body and returns the bare transaction', async () => {
      mockFetchResponse(200, bareTransaction);

      const result = await repo.update('lbctxn_123', {
        category: 'groceries',
        description: 'Trader Joes',
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/transactions/lbctxn_123');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(JSON.parse(opts.body)).toEqual({
        category: 'groceries',
        description: 'Trader Joes',
      });
      // The update response is not paginated/enveloped, unlike `list`.
      expect(result).toEqual(bareTransaction);
    });

    it('omits unset fields from the request body', async () => {
      mockFetchResponse(200, bareTransaction);

      await repo.update('lbctxn_123', { category: 'groceries' });

      const [, opts] = mockFetch.mock.calls[0]!;
      const body = JSON.parse(opts.body);
      expect(body).toEqual({ category: 'groceries' });
      expect('description' in body).toBe(false);
    });

    it('throws API errors with the response message', async () => {
      mockFetchResponse(400, {
        error: {
          code: 'invalid_category',
          message: 'Invalid category: shopping',
        },
      });

      await expect(
        repo.update('lbctxn_123', { category: 'shopping' }),
      ).rejects.toThrow(
        'Failed to update transaction (400): Invalid category: shopping',
      );
    });
  });
});
