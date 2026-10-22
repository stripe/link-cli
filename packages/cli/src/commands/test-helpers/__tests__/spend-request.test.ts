import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestHelpersSpendRequestResource } from '../spend-request';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('TestHelpersSpendRequestResource', () => {
  let repo: TestHelpersSpendRequestResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    repo = new TestHelpersSpendRequestResource({
      getAccessToken,
      spendRequestBaseUrl: 'https://custom.link.com/prefix',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('approves a spend request and returns its status', async () => {
    const response = { id: 'si_123', status: 'requires_action' };
    mockFetchResponse(200, response);

    await expect(repo.approve('si_123')).resolves.toEqual(response);

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      'https://custom.link.com/prefix/test_helpers/spend_requests/si_123/approve',
    );
    expect(opts.method).toBe('POST');
    expect(new Headers(opts.headers).get('Authorization')).toBe(
      'Bearer test_token',
    );
    expect(opts.body).toBeUndefined();
  });

  it('encodes the spend request ID in the approval path', async () => {
    mockFetchResponse(200, { id: 'si_123', status: 'approved' });

    await repo.approve('../../other?x=');

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'https://custom.link.com/prefix/test_helpers/spend_requests/..%2F..%2Fother%3Fx%3D/approve',
    );
  });

  it('refreshes authentication once after a 401', async () => {
    const response = { id: 'si_123', status: 'approved' };
    mockFetchResponse(200, response);
    mockFetch.mockResolvedValueOnce({
      status: 401,
      text: async () => JSON.stringify({ error: 'expired token' }),
    });
    getAccessToken.mockResolvedValueOnce('expired_token');

    await expect(repo.approve('si_123')).resolves.toEqual(response);

    expect(getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(
      new Headers(mockFetch.mock.calls[0]![1].headers).get('Authorization'),
    ).toBe('Bearer expired_token');
    expect(
      new Headers(mockFetch.mock.calls[1]![1].headers).get('Authorization'),
    ).toBe('Bearer test_token');
  });

  it('preserves API errors', async () => {
    const response = { error: { message: 'Request must be in demo mode' } };
    mockFetchResponse(400, response);

    await expect(repo.approve('si_123')).rejects.toMatchObject({
      code: 'api_error',
      status: 400,
      message:
        'Failed to approve test request (400): Request must be in demo mode',
      details: response,
    });
  });

  it('rejects invalid decision responses', async () => {
    mockFetchResponse(200, { id: 'si_123' });

    await expect(repo.approve('si_123')).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
    });
  });
});
