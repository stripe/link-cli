import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SummariesResource } from '@/resources/summaries';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

const READY_SUMMARY = {
  id: 'sum_123',
  description: 'Your recent activity',
  created_at: '2026-09-15T18:30:00Z',
  status: 'ready',
  entries: [
    { label: 'Payments', value: { unit: 'count', count: 1234 } },
    {
      label: 'Payment volume',
      value: { unit: 'payment_volume', amount: 12345, currency: 'usd' },
    },
  ],
};

const LIVE_READY_SUMMARY = {
  id: 'sum_live_123',
  description: 'Your recent activity',
  status: 'ready',
  entries: [],
  as_of: 1726358400,
  data: [{ label: 'Payments', value: { unit: 'count', amount: 1 } }],
};

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    statusText: '',
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  });
}

describe('SummariesResource', () => {
  let resource: SummariesResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    vi.stubEnv('LINK_API_BASE_URL', undefined);
    getAccessToken.mockResolvedValue('test_token');
    resource = new SummariesResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('GETs summaries with bearer auth and does not send a limit', async () => {
    mockFetchResponse(200, { data: [READY_SUMMARY], has_more: false });

    await expect(resource.list()).resolves.toEqual({
      data: [READY_SUMMARY],
      has_more: false,
    });

    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/summaries');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer test_token');
    expect(new URL(url).searchParams.has('limit')).toBe(false);
  });

  it('preserves a ready summary in the live data and as_of response shape', async () => {
    mockFetchResponse(200, { data: [LIVE_READY_SUMMARY] });

    const page = await resource.list();
    const liveSummary = page.data[0]!;

    expect(liveSummary.as_of).toBe(LIVE_READY_SUMMARY.as_of);
    expect(liveSummary.data).toEqual(LIVE_READY_SUMMARY.data);
    expect(page).toEqual({
      data: [LIVE_READY_SUMMARY],
    });
  });

  it('uses the configured base URL and encodes the cursor and repeated summary filters', async () => {
    resource = new SummariesResource({
      getAccessToken,
      apiBaseUrl: 'https://api.qa.link.com',
    });
    mockFetchResponse(200, { data: [] });

    await resource.list({
      starting_after: 'sum_cursor',
      summaries: ['spending', 'income'],
    });

    const url = new URL(mockFetch.mock.calls[0]![0]);
    expect(url.origin).toBe('https://api.qa.link.com');
    expect(url.pathname).toBe('/summaries');
    expect(url.searchParams.get('starting_after')).toBe('sum_cursor');
    expect(url.searchParams.getAll('summaries[]')).toEqual([
      'spending',
      'income',
    ]);
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('refreshes the access token and retries once on 401', async () => {
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

    await expect(resource.list()).resolves.toEqual({ data: [] });
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(mockFetch.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('surfaces API errors', async () => {
    mockFetchResponse(500, { message: 'boom' });
    await expect(resource.list()).rejects.toThrow(
      'Failed to list summaries (500): boom',
    );
  });

  it.each([
    ['pending', { ...READY_SUMMARY, status: 'pending', entries: [] }],
    ['no-data', { ...READY_SUMMARY, status: 'no_data', entries: [] }],
    [
      'ready count without a currency',
      {
        ...READY_SUMMARY,
        entries: [{ label: 'Payments', value: { unit: 'count', count: 2 } }],
      },
    ],
  ])('accepts a valid %s summary response', async (_name, summary) => {
    mockFetchResponse(200, { data: [summary] });
    await expect(resource.list()).resolves.toEqual({ data: [summary] });
  });

  it('accepts a ready summary whose entries are omitted', async () => {
    const { entries: _entries, ...summaryWithoutEntries } = READY_SUMMARY;
    mockFetchResponse(200, { data: [summaryWithoutEntries] });

    await expect(resource.list()).resolves.toEqual({
      data: [{ ...summaryWithoutEntries, entries: [] }],
    });
  });

  it('rejects malformed summary data rather than passing it to callers', async () => {
    mockFetchResponse(200, {
      data: [{ ...READY_SUMMARY, entries: [{ label: 'Payments', value: {} }] }],
    });
    await expect(resource.list()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });
});
