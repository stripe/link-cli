import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpendingPolicyResource } from '@/resources/spending-policy';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    status,
    statusText: '',
    headers: new Headers(),
    text: async () => JSON.stringify(body),
  });
}

describe('SpendingPolicyResource', () => {
  let resource: SpendingPolicyResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    resource = new SpendingPolicyResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retrieves and parses the spending policy', async () => {
    const policy = {
      rules: [
        {
          action: 'allow',
          approval_type: 'automatic',
          limits: {
            per_purchase: { amount: 5000, currency: 'usd' },
          },
          allowed_payment_methods: ['csmrpd_2', 'csmrpd_1'],
        },
        { action: 'allow' },
      ],
    };
    mockFetchResponse(200, policy);

    await expect(resource.retrieve()).resolves.toEqual(policy);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/spending-policy');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
  });

  it('accepts the manual-only default policy', async () => {
    mockFetchResponse(200, {
      rules: [{ action: 'allow', approval_type: 'manual' }],
    });

    await expect(resource.retrieve()).resolves.toEqual({
      rules: [{ action: 'allow', approval_type: 'manual' }],
    });
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(403, {
      error: { code: 'feature_unavailable' },
    });

    await expect(resource.retrieve()).rejects.toThrow(
      'Failed to retrieve spending policy (403): feature_unavailable',
    );
  });

  it('throws when the response shape is invalid', async () => {
    mockFetchResponse(200, { rules: 'not an array' });

    await expect(resource.retrieve()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });
});
