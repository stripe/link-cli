import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalPolicyResource } from '@/resources/approval-policy';

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

describe('ApprovalPolicyResource', () => {
  let resource: ApprovalPolicyResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    resource = new ApprovalPolicyResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retrieves and parses the approval policy', async () => {
    const policy = {
      rules: [
        {
          action: 'spend_request_create',
          limits: {
            per_purchase: { amount: 5000, currency: 'usd' },
          },
          allowed_payment_methods: ['csmrpd_2', 'csmrpd_1'],
        },
      ],
    };
    mockFetchResponse(200, policy);

    await expect(resource.retrieve()).resolves.toEqual(policy);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.link.com/approval-policy');
    expect(opts.method).toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer test_token');
  });

  it('throws API errors with the response message', async () => {
    mockFetchResponse(403, {
      error: { code: 'feature_unavailable' },
    });

    await expect(resource.retrieve()).rejects.toThrow(
      'Failed to retrieve approval policy (403): feature_unavailable',
    );
  });

  it('throws the configured-policy not-found error', async () => {
    mockFetchResponse(404, {
      error: {
        message: 'No approval policy has been configured',
        code: 'approval_policy_not_found',
      },
    });

    await expect(resource.retrieve()).rejects.toMatchObject({
      status: 404,
      message:
        'Failed to retrieve approval policy (404): No approval policy has been configured',
    });
  });

  it('accepts an explicitly empty policy', async () => {
    mockFetchResponse(200, { rules: [] });

    await expect(resource.retrieve()).resolves.toEqual({ rules: [] });
  });

  it('requires limits on every rule', async () => {
    mockFetchResponse(200, {
      rules: [{ action: 'spend_request_create' }],
    });

    await expect(resource.retrieve()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });

  it('throws when the response shape is invalid', async () => {
    mockFetchResponse(200, { rules: 'not an array' });

    await expect(resource.retrieve()).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });
});
