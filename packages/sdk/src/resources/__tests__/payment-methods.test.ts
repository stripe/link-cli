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
          name: 'Visa Credit',
          nickname: 'Home Credit',
        },
      ],
    });

    const result = await repo.list();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
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
        name: 'Visa Credit',
        nickname: 'Home Credit',
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

    const result = await repo.list();

    expect(result).toEqual([]);
    expect(getAccessToken).toHaveBeenNthCalledWith(1);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('does not retry a 401 when configured with a fixed access token', async () => {
    repo = new PaymentMethodsResource({ accessToken: 'fixed_token' });
    mockFetchResponse(401, { error: 'expired_token' });

    await expect(repo.list()).rejects.toThrow(
      'Failed to list payment methods (401): expired_token',
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('never logs tokens or response bodies in verbose mode', async () => {
    const debug = vi.fn();
    repo = new PaymentMethodsResource({
      getAccessToken,
      verbose: true,
      logger: { debug },
    });
    mockFetchResponse(200, {
      payment_details: [{ id: 'pm_secret', type: 'card', is_default: true, name: 'Visa Credit', nickname: 'Home Credit' }],
    });

    await repo.list();

    const output = debug.mock.calls.flat().join('\n');
    expect(output).not.toContain('test_token');
    expect(output).not.toContain('pm_secret');
  });

  it('rejects malformed successful responses', async () => {
    mockFetchResponse(200, {
      payment_details: [{ id: 123, type: 'card', is_default: true, name: 'Visa Credit', nickname: 'Home Credit' }],
    });

    const error = await repo.list().catch((cause) => cause);
    expect(error.code).toBe('invalid_response');
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(403, { message: 'Forbidden' });

    await expect(repo.list()).rejects.toThrow(
      'Failed to list payment methods (403): Forbidden',
    );
  });

  it('extracts message from nested error object instead of [object Object]', async () => {
    mockFetchResponse(400, { error: { message: 'card not supported' } });

    await expect(repo.list()).rejects.toThrow(
      'Failed to list payment methods (400): card not supported',
    );
  });

  it('throws when no access token is available', async () => {
    getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

    await expect(repo.list()).rejects.toThrow('Missing access token');
  });
});
