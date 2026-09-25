import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkApiError } from '@/errors';
import { PaymentMethodsResource } from '@/resources/payment-methods';

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

  it('lists Link balance details when available', async () => {
    mockFetchResponse(200, {
      payment_details: [
        {
          id: 'csmrpd_balance',
          type: 'BALANCE',
          is_default: false,
          name: 'Link balance',
          card_details: null,
          bank_account_details: null,
          balance_details: {
            available_balance: { amount: 1250, currency: 'usd' },
          },
        },
      ],
      unavailable_count: 0,
    });

    await expect(repo.list()).resolves.toEqual([
      {
        id: 'csmrpd_balance',
        type: 'BALANCE',
        is_default: false,
        name: 'Link balance',
        card_details: null,
        bank_account_details: null,
        balance_details: {
          available_balance: { amount: 1250, currency: 'usd' },
        },
      },
    ]);
  });

  it('preserves balance details when the available balance is unknown', async () => {
    mockFetchResponse(200, {
      payment_details: [
        {
          id: 'csmrpd_balance',
          type: 'BALANCE',
          is_default: false,
          name: 'Link balance',
          balance_details: {},
        },
      ],
      unavailable_count: 0,
    });

    const result = await repo.list();

    expect(result[0]?.balance_details).toEqual({});
  });

  it('retrieves a payment method from the expected endpoint', async () => {
    mockFetchResponse(200, {
      id: 'pd_123',
      type: 'CARD',
      is_default: true,
      name: 'Visa',
      card_details: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2028,
      },
    });

    const result = await repo.retrieve('pd_123');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/payment-details/pd_123');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(result).toMatchObject({ id: 'pd_123', name: 'Visa' });
  });

  it('returns null when a payment method is not found', async () => {
    mockFetchResponse(404, {
      error: { message: 'Payment details not found' },
    });

    await expect(repo.retrieve('pd_missing')).resolves.toBeNull();
  });

  it('updates a payment-method nickname', async () => {
    mockFetchResponse(200, {
      id: 'pd_123',
      type: 'CARD',
      is_default: true,
      name: 'Visa',
      nickname: 'Work card',
    });

    const result = await repo.update('pd_123', { nickname: 'Work card' });

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/payment-details/pd_123');
    expect(opts).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test_token',
        'Content-Type': 'application/json',
      },
      body: '{"nickname":"Work card"}',
    });
    expect(result).toMatchObject({ id: 'pd_123', nickname: 'Work card' });
  });

  it('preserves an empty nickname when clearing', async () => {
    mockFetchResponse(200, {
      id: 'pd_123',
      type: 'CARD',
      is_default: true,
      name: 'Visa',
      nickname: null,
    });

    await expect(
      repo.update('pd_123', { nickname: '' }),
    ).resolves.toMatchObject({
      nickname: null,
    });
    expect(mockFetch.mock.calls[0]![1].body).toBe('{"nickname":""}');
  });

  it('encodes the payment method ID in the update path', async () => {
    mockFetchResponse(200, {
      id: 'pd/../other',
      type: 'CARD',
      is_default: false,
      name: 'Visa',
    });

    await repo.update('pd/../other', { nickname: 'Work' });

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'https://api.link.com/payment-details/pd%2F..%2Fother',
    );
  });

  it.each([
    [400, 'nickname is too long'],
    [403, 'Nickname updates are unavailable'],
    [404, 'Payment method not found'],
  ])('throws a typed update error for %s', async (status, message) => {
    mockFetchResponse(status, { error: { message } });

    const error = await repo
      .update('pd_123', { nickname: 'Work' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(LinkApiError);
    expect(error).toMatchObject({ status });
    expect(error.message).toContain(message);
  });

  it('rejects malformed successful update responses', async () => {
    mockFetchResponse(200, { id: 123 });

    const error = await repo
      .update('pd_123', { nickname: 'Work' })
      .catch((e) => e);
    expect(error.code).toBe('invalid_response');
  });

  it('refreshes and retries an update once on 401', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 401,
        text: async () => JSON.stringify({ error: 'expired_token' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'pd_123',
            type: 'CARD',
            is_default: true,
            name: 'Visa',
            nickname: 'Work',
          }),
      });
    getAccessToken
      .mockResolvedValueOnce('test_token')
      .mockResolvedValueOnce('fresh_token');

    await repo.update('pd_123', { nickname: 'Work' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('does not retry a fixed-token update after a 401', async () => {
    repo = new PaymentMethodsResource({ accessToken: 'fixed_token' });
    mockFetchResponse(401, { error: 'expired_token' });

    await expect(repo.update('pd_123', { nickname: 'Work' })).rejects.toThrow(
      'Failed to update payment method (401): expired_token',
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('encodes the payment method ID in the retrieve path', async () => {
    mockFetchResponse(404, {
      error: { message: 'Payment details not found' },
    });

    await repo.retrieve('pd/../other');

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'https://api.link.com/payment-details/pd%2F..%2Fother',
    );
  });

  it('throws non-404 retrieve errors', async () => {
    mockFetchResponse(500, { error: 'internal_error' });

    await expect(repo.retrieve('pd_123')).rejects.toThrow(
      'Failed to retrieve payment method (500): internal_error',
    );
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
      payment_details: [
        {
          id: 'pm_secret',
          type: 'card',
          is_default: true,
          name: 'Visa Credit',
          nickname: 'Home Credit',
        },
      ],
    });

    await repo.list();

    const output = debug.mock.calls.flat().join('\n');
    expect(output).not.toContain('test_token');
    expect(output).not.toContain('pm_secret');
  });

  it('rejects malformed successful responses', async () => {
    mockFetchResponse(200, {
      payment_details: [
        {
          id: 123,
          type: 'card',
          is_default: true,
          name: 'Visa Credit',
          nickname: 'Home Credit',
        },
      ],
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
