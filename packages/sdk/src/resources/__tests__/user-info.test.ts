import { UserInfoResource } from '@/resources/user-info';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('UserInfoResource', () => {
  let resource: UserInfoResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    resource = new UserInfoResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retrieves user info from the expected endpoint', async () => {
    mockFetchResponse(200, {
      email: 'user@example.com',
      name: 'Test User',
      phone: '+15551234567',
    });

    const result = await resource.retrieve();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.link.com/userinfo');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(result).toEqual({
      email: 'user@example.com',
      name: 'Test User',
      first_name: null,
      last_name: null,
      phone: '+15551234567',
    });
  });

  it('parses first_name and last_name fields', async () => {
    mockFetchResponse(200, {
      email: 'user@example.com',
      name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      phone: '+15551234567',
    });

    const result = await resource.retrieve();

    expect(result).toEqual({
      email: 'user@example.com',
      name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      phone: '+15551234567',
    });
  });

  it('handles null fields gracefully', async () => {
    mockFetchResponse(200, {
      email: null,
      name: null,
      first_name: null,
      last_name: null,
      phone: null,
    });

    const result = await resource.retrieve();

    expect(result).toEqual({
      email: null,
      name: null,
      first_name: null,
      last_name: null,
      phone: null,
    });
  });

  it('handles missing fields gracefully', async () => {
    mockFetchResponse(200, {});

    const result = await resource.retrieve();

    expect(result).toEqual({
      email: null,
      name: null,
      first_name: null,
      last_name: null,
      phone: null,
    });
  });

  it('refreshes the token and retries once on 401', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 401,
        text: async () => JSON.stringify({ error: 'expired_token' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            email: 'user@example.com',
            name: null,
            phone: null,
          }),
      });
    getAccessToken
      .mockResolvedValueOnce('test_token')
      .mockResolvedValueOnce('fresh_token');

    const result = await resource.retrieve();

    expect(result).toEqual({
      email: 'user@example.com',
      name: null,
      first_name: null,
      last_name: null,
      phone: null,
    });
    expect(getAccessToken).toHaveBeenNthCalledWith(1);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(403, { message: 'Forbidden' });

    await expect(resource.retrieve()).rejects.toThrow(
      'Failed to retrieve user info (403): Forbidden',
    );
  });
});
