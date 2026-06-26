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
          category: 'credit_card_payment',
          status: 'succeeded',
        },
      ],
      has_more: true,
    });

    const result = await repo.listTransactions();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
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
          category: 'credit_card_payment',
          status: 'succeeded',
        },
      ],
      has_more: true,
    });
  });

  it('encodes optional list params in the query string', async () => {
    mockFetchResponse(200, { data: [] });

    await repo.listTransactions({
      limit: 50,
      starting_after: 'cursor_a',
      ending_before: 'cursor_b',
      start_date: '2026-06-08',
      end_date: '2026-06-09',
      category: 'shopping',
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('starting_after')).toBe('cursor_a');
    expect(url.searchParams.get('ending_before')).toBe('cursor_b');
    expect(url.searchParams.get('start_date')).toBe('2026-06-08');
    expect(url.searchParams.get('end_date')).toBe('2026-06-09');
    expect(url.searchParams.get('category')).toBe('shopping');
    expect(url.searchParams.has('transaction_category')).toBe(false);
  });

  it('resolves the base URL from LINK_API_BASE_URL when set', async () => {
    vi.stubEnv('LINK_API_BASE_URL', 'https://api.qa.link.com');
    repo = new TransactionsResource({ getAccessToken });
    mockFetchResponse(200, { data: [] });

    await repo.listTransactions();

    expect(mockFetch.mock.calls[0][0]).toBe(
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

    const result = await repo.listTransactions();

    expect(result).toEqual({ data: [] });
    expect(getAccessToken).toHaveBeenNthCalledWith(1);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(500, { message: 'boom' });

    await expect(repo.listTransactions()).rejects.toThrow(
      'Failed to list transactions (500): boom',
    );
  });

  it('throws when no access token is available', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

    await expect(repo.listTransactions()).rejects.toThrow(
      'Missing access token',
    );
  });

  it('throws when the response shape is invalid', async () => {
    mockFetchResponse(200, { data: [{ id: 'lbctxn_123' }] });

    await expect(repo.listTransactions()).rejects.toThrow(
      'Failed to list transactions (200): invalid response shape: Expected transactions[0].source_id to be a string or null',
    );
  });
});
