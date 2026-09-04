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
    const [url, opts] = mockFetch.mock.calls[0]!;
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

  it('preserves Agent Wallet spend limits and step-up status', async () => {
    const agentWalletSpendLimits = {
      per_transaction: { limit: 50000 },
      daily: { limit: 500000, used: 120000, remaining: 380000 },
      thirty_day: {
        limit: 2000000,
        used: 600000,
        remaining: 1400000,
      },
    };
    const agentWalletStepUp = { status: 'identity_verification' };
    mockFetchResponse(200, {
      email: 'user@example.com',
      name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      phone: '+15551234567',
      agent_wallet_spend_limits: agentWalletSpendLimits,
      agent_wallet_step_up: agentWalletStepUp,
    });

    const result = await resource.retrieve();

    expect(result).toEqual({
      email: 'user@example.com',
      name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      phone: '+15551234567',
      agent_wallet_spend_limits: agentWalletSpendLimits,
      agent_wallet_step_up: agentWalletStepUp,
    });
  });

  it('preserves unlimited limits and numeric usage', async () => {
    mockFetchResponse(200, {
      agent_wallet_spend_limits: {
        per_transaction: { limit: null },
        daily: { limit: null, used: 0, remaining: null },
        thirty_day: { limit: null, used: 12345, remaining: null },
      },
    });

    const result = await resource.retrieve();

    expect(result.agent_wallet_spend_limits).toEqual({
      per_transaction: { limit: null },
      daily: { limit: null, used: 0, remaining: null },
      thirty_day: { limit: null, used: 12345, remaining: null },
    });
  });

  it('keeps independently omitted enrichment fields undefined', async () => {
    mockFetchResponse(200, {
      email: 'user@example.com',
      agent_wallet_step_up: { status: 'not_required' },
    });

    const result = await resource.retrieve();

    expect(result.agent_wallet_spend_limits).toBeUndefined();
    expect(result.agent_wallet_step_up).toEqual({ status: 'not_required' });
    expect(result).not.toHaveProperty('agent_wallet_spend_limits');
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
    expect(result.agent_wallet_spend_limits).toBeUndefined();
    expect(result.agent_wallet_step_up).toBeUndefined();
    expect(result).not.toHaveProperty('agent_wallet_spend_limits');
    expect(result).not.toHaveProperty('agent_wallet_step_up');
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
    expect(mockFetch.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer fresh_token',
    );
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(403, { message: 'Forbidden' });

    await expect(resource.retrieve()).rejects.toThrow(
      'Failed to retrieve user info (403): Forbidden',
    );
  });

  it('extracts message from nested error object instead of [object Object]', async () => {
    mockFetchResponse(400, { error: { message: 'user not found' } });

    await expect(resource.retrieve()).rejects.toThrow(
      'Failed to retrieve user info (400): user not found',
    );
  });
});
