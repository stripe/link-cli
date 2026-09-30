import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightsResource } from '@/resources/insights';

const mockFetch = vi.fn();

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    status,
    statusText: '',
    text: async () => JSON.stringify(body),
  });
}

describe('InsightsResource', () => {
  let resource: InsightsResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    vi.stubEnv('LINK_API_BASE_URL', undefined);
    resource = new InsightsResource({ getAccessToken: () => 'test_token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('lists available insight types with pagination and remediation', async () => {
    const page = {
      data: [
        {
          id: 'top_brand_by_transaction_count_per_category_t180d',
          description: 'Top brands',
          authorization_remediation: {
            authorization_details: [
              {
                type: 'source',
                actions: [
                  'read_link_transactions',
                  'read_external_transactions',
                ],
              },
            ],
          },
        },
      ],
      has_more: true,
    };
    respond(200, page);

    await expect(
      resource.listAvailableTypes({ limit: 1, starting_after: 'previous' }),
    ).resolves.toEqual(page);
    const [rawUrl, init] = mockFetch.mock.calls[0]!;
    const url = new URL(rawUrl);
    expect(url.origin + url.pathname).toBe(
      'https://api.link.com/insights/available_types',
    );
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('starting_after')).toBe('previous');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test_token');
  });

  it('rejects an invalid page and preserves API errors', async () => {
    respond(200, { data: [{ id: 'abc' }], has_more: false });
    await expect(resource.listAvailableTypes()).rejects.toMatchObject({
      code: 'invalid_response',
    });

    respond(400, { error: { message: 'Invalid limit' } });
    await expect(resource.listAvailableTypes()).rejects.toThrow(
      'Invalid limit',
    );
  });
});
