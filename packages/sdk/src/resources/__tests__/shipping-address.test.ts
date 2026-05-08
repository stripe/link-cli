import { ShippingAddressResource } from '@/resources/shipping-address';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('ShippingAddressResource', () => {
  let repo: ShippingAddressResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    repo = new ShippingAddressResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists shipping addresses from the expected endpoint', async () => {
    mockFetchResponse(200, {
      shipping_addresses: [
        {
          id: 'shad_123',
          is_default: true,
          nickname: 'Home',
          address: {
            name: 'Jane Doe',
            line_1: '123 Main St',
            line_2: 'Apt 4B',
            locality: 'San Francisco',
            dependent_locality: null,
            administrative_area: 'CA',
            postal_code: '94105',
            sorting_code: null,
            country_code: 'US',
          },
        },
      ],
    });

    const result = await repo.listShippingAddresses();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.link.com/shipping_addresses');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(result).toEqual([
      {
        id: 'shad_123',
        is_default: true,
        nickname: 'Home',
        address: {
          name: 'Jane Doe',
          line_1: '123 Main St',
          line_2: 'Apt 4B',
          locality: 'San Francisco',
          dependent_locality: null,
          administrative_area: 'CA',
          postal_code: '94105',
          sorting_code: null,
          country_code: 'US',
        },
      },
    ]);
  });

  it('preserves null nickname and address fields', async () => {
    mockFetchResponse(200, {
      shipping_addresses: [
        {
          id: 'shad_456',
          is_default: false,
          nickname: null,
          address: null,
        },
      ],
    });

    await expect(repo.listShippingAddresses()).resolves.toEqual([
      {
        id: 'shad_456',
        is_default: false,
        nickname: null,
        address: null,
      },
    ]);
  });

  it('refreshes the token and retries once on 401', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 401,
        text: async () => JSON.stringify({ error: 'expired_token' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ shipping_addresses: [] }),
      });
    getAccessToken
      .mockResolvedValueOnce('test_token')
      .mockResolvedValueOnce('fresh_token');

    const result = await repo.listShippingAddresses();

    expect(result).toEqual([]);
    expect(getAccessToken).toHaveBeenNthCalledWith(1);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(403, { message: 'Forbidden' });

    await expect(repo.listShippingAddresses()).rejects.toThrow(
      'Failed to list shipping addresses (403): Forbidden',
    );
  });

  it('throws when no access token is available', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

    await expect(repo.listShippingAddresses()).rejects.toThrow(
      'Missing access token',
    );
  });
});
