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
    expect(opts.headers.Authorization).toBe('Bearer test_token');
    expect(opts.body).toBeUndefined();
  });

  it('encodes the spend request ID in the approval path', async () => {
    mockFetchResponse(200, { id: 'si_123', status: 'approved' });

    await repo.approve('../../other?x=');

    expect(mockFetch.mock.calls[0]![0]).toBe(
      'https://custom.link.com/prefix/test_helpers/spend_requests/..%2F..%2Fother%3Fx%3D/approve',
    );
  });
});
