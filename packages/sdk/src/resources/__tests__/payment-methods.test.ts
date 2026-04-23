import { PaymentMethodsResource } from '@/resources/payment-methods';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('PaymentMethodsResource', () => {
  let repo: PaymentMethodsResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    repo = new PaymentMethodsResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists payment methods from the expected endpoint', async () => {
    mockFetchResponse(200, {
      payment_details: [
        {
          id: 'pm_123',
          type: 'card',
          is_default: true,
          card_details: {
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2028,
          },
        },
      ],
    });

    const result = await repo.listPaymentMethods();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.link.com/payment-details');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(result).toEqual([
      {
        id: 'pm_123',
        type: 'card',
        is_default: true,
        card_details: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2028,
        },
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
        text: async () => JSON.stringify({ payment_details: [] }),
      });
    getAccessToken
      .mockResolvedValueOnce('test_token')
      .mockResolvedValueOnce('fresh_token');

    const result = await repo.listPaymentMethods();

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

    await expect(repo.listPaymentMethods()).rejects.toThrow(
      'Failed to list payment methods (403): Forbidden',
    );
  });

  it('throws when no access token is available', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

    await expect(repo.listPaymentMethods()).rejects.toThrow(
      'Missing access token',
    );
  });
});
