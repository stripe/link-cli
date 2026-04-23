import type { CreateSpendRequestParams } from '@/resources/interfaces';
import { SpendRequestResource } from '@/resources/spend-request';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

function mockFetchRawResponse(status: number, rawBody: string) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => rawBody,
  });
}

const validParams: CreateSpendRequestParams = {
  payment_details: 'pd_test123',
  merchant_name: 'Test Merchant',
  merchant_url: 'https://example.com',
  context: 'Office supplies',
  line_items: [{ name: 'Widget', unit_amount: 5000, quantity: 1 }],
  totals: [{ type: 'total', display_text: 'Total', amount: 5000 }],
};

const spendRequestResponse = {
  id: 'si_123',
  merchant_name: 'Test Merchant',
  merchant_url: 'https://example.com',
  context: 'Office supplies',
  line_items: [{ name: 'Widget', unit_amount: 5000, quantity: 1 }],
  totals: [{ type: 'total', display_text: 'Total', amount: 5000 }],
  payment_details: 'pd_test123',
  status: 'pending',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
};

describe('SpendRequestResource', () => {
  let repo: SpendRequestResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    repo = new SpendRequestResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('createSpendRequest', () => {
    it('sends POST to correct endpoint with JSON body and Bearer auth header', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.createSpendRequest(validParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.link.com/spend_requests');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBe(JSON.stringify(validParams));
    });

    it('returns SpendRequest on success', async () => {
      mockFetchResponse(200, spendRequestResponse);

      const result = await repo.createSpendRequest(validParams);

      expect(result).toEqual(spendRequestResponse);
    });

    it('throws on HTTP error with error message from body', async () => {
      mockFetchResponse(422, { error: { message: 'Invalid payment details' } });

      await expect(repo.createSpendRequest(validParams)).rejects.toThrow(
        'Failed to create spend request (422): Invalid payment details',
      );
    });

    it('throws on non-JSON error body with raw body in message', async () => {
      mockFetchRawResponse(502, 'Bad Gateway');

      await expect(repo.createSpendRequest(validParams)).rejects.toThrow(
        'Failed to create spend request (502): Bad Gateway',
      );
    });

    it('serializes credential_type and network_id in POST body and returns them', async () => {
      const paramsWithCredential: CreateSpendRequestParams = {
        ...validParams,
        credential_type: 'shared_payment_token',
        network_id: 'net_abc',
      };
      const responseWithCredential = {
        ...spendRequestResponse,
        credential_type: 'shared_payment_token',
        network_id: 'net_abc',
      };
      mockFetchResponse(200, responseWithCredential);

      const result = await repo.createSpendRequest(paramsWithCredential);

      const [, opts] = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.credential_type).toBe('shared_payment_token');
      expect(sentBody.network_id).toBe('net_abc');
      expect(result.credential_type).toBe('shared_payment_token');
      expect(result.network_id).toBe('net_abc');
    });

    it('serializes test flag in POST body when true', async () => {
      const paramsWithTest: CreateSpendRequestParams = {
        ...validParams,
        test: true,
      };
      mockFetchResponse(200, spendRequestResponse);

      await repo.createSpendRequest(paramsWithTest);

      const [, opts] = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.test).toBe(true);
    });

    it('does not include test in POST body when not set', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.createSpendRequest(validParams);

      const [, opts] = mockFetch.mock.calls[0];
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.test).toBeUndefined();
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.createSpendRequest(validParams)).rejects.toThrow(
        'Missing access token',
      );
    });
  });

  describe('updateSpendRequest', () => {
    it('sends POST to correct endpoint with JSON body', async () => {
      mockFetchResponse(200, {
        ...spendRequestResponse,
        payment_details: 'pd_new',
      });

      await repo.updateSpendRequest('si_123', { payment_details: 'pd_new' });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.link.com/spend_requests/si_123');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBe(JSON.stringify({ payment_details: 'pd_new' }));
    });

    it('returns updated SpendRequest on success', async () => {
      const updated = { ...spendRequestResponse, payment_details: 'pd_new' };
      mockFetchResponse(200, updated);

      const result = await repo.updateSpendRequest('si_123', {
        payment_details: 'pd_new',
      });

      expect(result).toEqual(updated);
    });

    it('throws on HTTP error', async () => {
      mockFetchResponse(409, {
        error: { message: 'Cannot update request in awaiting_approval status' },
      });

      await expect(
        repo.updateSpendRequest('si_123', { payment_details: 'pd_new' }),
      ).rejects.toThrow(
        'Failed to update spend request (409): Cannot update request in awaiting_approval status',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(
        repo.updateSpendRequest('si_123', { payment_details: 'pd_new' }),
      ).rejects.toThrow('Missing access token');
    });
  });

  describe('requestApproval', () => {
    it('sends POST to request_approval endpoint with no body', async () => {
      const approvalResponse = {
        id: 'si_123',
        approval_link: 'https://app.link.com/approve/si_123',
      };
      mockFetchResponse(200, approvalResponse);

      await repo.requestApproval('si_123');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://api.link.com/spend_requests/si_123/request_approval',
      );
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBeUndefined();
    });

    it('returns RequestApprovalResponse with id and approval_link', async () => {
      const approvalResponse = {
        id: 'si_123',
        approval_link: 'https://app.link.com/approve/si_123',
      };
      mockFetchResponse(200, approvalResponse);

      const result = await repo.requestApproval('si_123');

      expect(result.id).toBe('si_123');
      expect(result.approval_link).toBe('https://app.link.com/approve/si_123');
    });

    it('throws on HTTP error', async () => {
      mockFetchResponse(400, {
        error: { message: 'Request already awaiting approval' },
      });

      await expect(repo.requestApproval('si_123')).rejects.toThrow(
        'Failed to request approval (400): Request already awaiting approval',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.requestApproval('si_123')).rejects.toThrow(
        'Missing access token',
      );
    });
  });

  describe('getSpendRequest', () => {
    it('sends GET to retrieve endpoint', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.getSpendRequest('si_123');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.link.com/spend_requests/si_123');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
    });

    it('returns SpendRequest on success', async () => {
      mockFetchResponse(200, spendRequestResponse);

      const result = await repo.getSpendRequest('si_123');

      expect(result).toEqual(spendRequestResponse);
    });

    it('returns SpendRequest with card after approval', async () => {
      const approvedResponse = {
        ...spendRequestResponse,
        status: 'approved',
        card: {
          id: 'card_001',
          brand: 'Visa',
          exp_month: 12,
          exp_year: 2027,
          number: '4242424242424242',
        },
      };
      mockFetchResponse(200, approvedResponse);

      const result = await repo.getSpendRequest('si_123');

      expect(result?.status).toBe('approved');
      expect(result?.card).toEqual({
        id: 'card_001',
        brand: 'Visa',
        exp_month: 12,
        exp_year: 2027,
        number: '4242424242424242',
      });
    });

    it('normalizes legacy string shared_payment_token to object form', async () => {
      mockFetchResponse(200, {
        ...spendRequestResponse,
        status: 'approved',
        credential_type: 'shared_payment_token',
        shared_payment_token: 'spt_legacy123',
      });

      const result = await repo.getSpendRequest('si_123');

      expect(result?.shared_payment_token).toEqual({ id: 'spt_legacy123' });
    });

    it('passes through object shared_payment_token unchanged', async () => {
      const sptObj = {
        id: 'spt_new123',
        billing_address: { name: 'Jane', line1: '1 Main St', country: 'US' },
        valid_until: '2026-12-31T00:00:00Z',
      };
      mockFetchResponse(200, {
        ...spendRequestResponse,
        status: 'approved',
        credential_type: 'shared_payment_token',
        shared_payment_token: sptObj,
      });

      const result = await repo.getSpendRequest('si_123');

      expect(result?.shared_payment_token).toEqual(sptObj);
    });

    it('returns null on 404', async () => {
      mockFetchResponse(404, {});

      const result = await repo.getSpendRequest('si_nonexistent');

      expect(result).toBeNull();
    });

    it('throws on other HTTP errors', async () => {
      mockFetchResponse(500, { error: { message: 'Internal server error' } });

      await expect(repo.getSpendRequest('si_123')).rejects.toThrow(
        'Failed to retrieve spend request (500): Internal server error',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.getSpendRequest('si_123')).rejects.toThrow(
        'Missing access token',
      );
    });
  });
});
