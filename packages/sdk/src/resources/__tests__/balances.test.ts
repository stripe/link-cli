import { BalancesResource } from '@/resources/balances';
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

describe('BalancesResource', () => {
  let repo: BalancesResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    vi.stubEnv('LINK_API_BASE_URL', undefined);
    getAccessToken.mockResolvedValue('test_token');
    repo = new BalancesResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('GETs the Link API balances endpoint with bearer auth', async () => {
    mockFetchResponse(200, {
      data: [
        {
          source_id: 'csmrpd_123',
          name: 'Checking 1234',
          type: 'bank_account',
          available: { amount: 12500, currency: 'usd' },
          current: { amount: 13000, currency: 'usd' },
        },
      ],
      has_more: true,
    });

    const result = await repo.listBalances();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.link.com/balances');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');

    expect(result).toEqual({
      data: [
        {
          source_id: 'csmrpd_123',
          name: 'Checking 1234',
          type: 'bank_account',
          available: { amount: 12500, currency: 'usd' },
          current: { amount: 13000, currency: 'usd' },
        },
      ],
      has_more: true,
    });
  });

  it('encodes optional list params in the query string', async () => {
    mockFetchResponse(200, { data: [] });

    await repo.listBalances({
      limit: 50,
      starting_after: 'cursor_a',
      ending_before: 'cursor_b',
    });

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('starting_after')).toBe('cursor_a');
    expect(url.searchParams.get('ending_before')).toBe('cursor_b');
  });

  it('resolves the base URL from LINK_API_BASE_URL when set', async () => {
    vi.stubEnv('LINK_API_BASE_URL', 'https://api.qa.link.com');
    repo = new BalancesResource({ getAccessToken });
    mockFetchResponse(200, { data: [] });

    await repo.listBalances();

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.qa.link.com/balances');
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

    const result = await repo.listBalances();

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

    await expect(repo.listBalances()).rejects.toThrow(
      'Failed to list balances (500): boom',
    );
  });

  it('formats nested API error messages', async () => {
    mockFetchResponse(401, {
      error: {
        message: 'Access token is missing required scopes: balances:read',
      },
    });
    getAccessToken
      .mockResolvedValueOnce('test_token')
      .mockResolvedValueOnce('fresh_token');

    await expect(repo.listBalances()).rejects.toThrow(
      'Failed to list balances (401): Access token is missing required scopes: balances:read',
    );
  });

  it('throws when no access token is available', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

    await expect(repo.listBalances()).rejects.toThrow('Missing access token');
  });

  it('throws when the response shape is invalid', async () => {
    mockFetchResponse(200, { data: 'not an array' });

    await expect(repo.listBalances()).rejects.toThrow(
      'Failed to list balances (200): invalid response shape: Expected balances to be an array',
    );
  });
});
