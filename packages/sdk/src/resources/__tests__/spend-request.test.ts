import { LinkApiError } from '@/errors';
import type { CreateSpendRequestParams } from '@/resources/interfaces';
import {
  SpendRequestResource,
  getDuplicateSpendRequest,
} from '@/resources/spend-request';
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
  status: 'pending_approval',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
};

const sparseSpendRequestResponse = {
  id: 'si_sparse',
  status: 'created',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
  shared_payment_token: null,
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

      await repo.create(validParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBe(JSON.stringify(validParams));
    });

    it('returns SpendRequest on success', async () => {
      mockFetchResponse(200, spendRequestResponse);

      const result = await repo.create(validParams);

      expect(result).toEqual(spendRequestResponse);
    });

    it('accepts omitted optional fields and a null shared payment token', async () => {
      mockFetchResponse(200, sparseSpendRequestResponse);

      await expect(repo.create(validParams)).resolves.toEqual(
        sparseSpendRequestResponse,
      );
    });

    it('accepts statuses added by newer API versions', async () => {
      const response = {
        ...sparseSpendRequestResponse,
        status: 'pending_merchant_action',
      };
      mockFetchResponse(200, response);

      await expect(repo.create(validParams)).resolves.toEqual(response);
    });

    it('rejects malformed successful responses', async () => {
      mockFetchResponse(200, { status: 'approved' });

      const error = await repo.create(validParams).catch((cause) => cause);
      expect(error.code).toBe('invalid_response');
    });

    it('throws on HTTP error with error message from body', async () => {
      mockFetchResponse(422, { error: { message: 'Invalid payment details' } });

      await expect(repo.create(validParams)).rejects.toThrow(
        'Failed to create spend request (422): Invalid payment details',
      );
    });

    it('throws on non-JSON error body with raw body in message', async () => {
      mockFetchRawResponse(502, 'Bad Gateway');

      await expect(repo.create(validParams)).rejects.toThrow(
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

      const result = await repo.create(paramsWithCredential);

      const [, opts] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.credential_type).toBe('shared_payment_token');
      expect(sentBody.network_id).toBe('net_abc');
      expect(result.credential_type).toBe('shared_payment_token');
      expect(result.network_id).toBe('net_abc');
    });

    it('serializes Link Pay Token execution fields in POST body', async () => {
      const paramsWithLptExecution: CreateSpendRequestParams = {
        ...validParams,
        execution_method: 'link_pay_token',
        merchant_account_id: 'acct_lpt_target',
      };
      mockFetchResponse(200, spendRequestResponse);

      await repo.create(paramsWithLptExecution);

      const [, opts] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.execution_method).toBe('link_pay_token');
      expect(sentBody.merchant_account_id).toBe('acct_lpt_target');
    });

    it('serializes metadata in POST body', async () => {
      const paramsWithMetadata: CreateSpendRequestParams = {
        ...validParams,
        metadata: { order_id: 'ord_123', team: 'growth' },
      };
      mockFetchResponse(200, spendRequestResponse);

      await repo.create(paramsWithMetadata);

      const [, opts] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.metadata).toEqual({
        order_id: 'ord_123',
        team: 'growth',
      });
    });

    it('does not include metadata in POST body when not set', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.create(validParams);

      const [, opts] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.metadata).toBeUndefined();
    });

    it('serializes test flag in POST body when true', async () => {
      const paramsWithTest: CreateSpendRequestParams = {
        ...validParams,
        test: true,
      };
      mockFetchResponse(200, spendRequestResponse);

      await repo.create(paramsWithTest);

      const [, opts] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.test).toBe(true);
    });

    it('does not include test in POST body when not set', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.create(validParams);

      const [, opts] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.test).toBeUndefined();
    });

    it('sends delegated requests to /spend_requests/create_delegated when approve is true', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.create({
        ...validParams,
        approve: true,
      });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests/create_delegated');
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.approve).toBeUndefined();
    });

    it('sends to /spend_requests when approve is not set', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.create(validParams);

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests');
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.create(validParams)).rejects.toThrow(
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

      await repo.update('si_123', { payment_details: 'pd_new' });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests/si_123');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBe(JSON.stringify({ payment_details: 'pd_new' }));
    });

    it('sends delegated updates to update_delegated without the approve routing flag', async () => {
      mockFetchResponse(200, {
        ...spendRequestResponse,
        amount: 6000,
        approval_url: 'https://app.link.com/approve/si_123',
      });

      await repo.update('si_123', { amount: 6000, approve: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.link.com/spend_requests/si_123/update_delegated',
        expect.objectContaining({ body: JSON.stringify({ amount: 6000 }) }),
      );
    });

    it('uses the standard endpoint when approve is false', async () => {
      mockFetchResponse(200, { ...spendRequestResponse, amount: 6000 });

      await repo.update('si_123', { amount: 6000, approve: false });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.link.com/spend_requests/si_123',
        expect.objectContaining({ body: JSON.stringify({ amount: 6000 }) }),
      );
    });

    it('returns updated SpendRequest on success', async () => {
      const updated = { ...spendRequestResponse, payment_details: 'pd_new' };
      mockFetchResponse(200, updated);

      const result = await repo.update('si_123', {
        payment_details: 'pd_new',
      });

      expect(result).toEqual(updated);
    });

    it('throws on HTTP error', async () => {
      mockFetchResponse(409, {
        error: { message: 'Cannot update request in awaiting_approval status' },
      });

      await expect(
        repo.update('si_123', { payment_details: 'pd_new' }),
      ).rejects.toThrow(
        'Failed to update spend request (409): Cannot update request in awaiting_approval status',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(
        repo.update('si_123', { payment_details: 'pd_new' }),
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

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        'https://api.link.com/spend_requests/si_123/request_approval',
      );
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBeUndefined();
    });

    it('normalizes approval_link to approval_url', async () => {
      const approvalResponse = {
        id: 'si_123',
        approval_link: 'https://app.link.com/approve/si_123',
      };
      mockFetchResponse(200, approvalResponse);

      const result = await repo.requestApproval('si_123');

      expect(result.id).toBe('si_123');
      expect(result.approval_url).toBe('https://app.link.com/approve/si_123');
      expect(result).not.toHaveProperty('approval_link');
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

  describe('cancelSpendRequest', () => {
    it('sends POST to cancel endpoint with Bearer auth and no body', async () => {
      const canceledResponse = { ...spendRequestResponse, status: 'canceled' };
      mockFetchResponse(200, canceledResponse);

      await repo.cancel('si_123');

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests/si_123/cancel');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBeUndefined();
    });

    it('returns SpendRequest with canceled status on success', async () => {
      const canceledResponse = { ...spendRequestResponse, status: 'canceled' };
      mockFetchResponse(200, canceledResponse);

      const result = await repo.cancel('si_123');

      expect(result.status).toBe('canceled');
      expect(result.id).toBe('si_123');
    });

    it('throws on 404 not found', async () => {
      mockFetchResponse(404, { error: { message: 'Spend request not found' } });

      await expect(repo.cancel('si_nonexistent')).rejects.toThrow(
        'Failed to cancel spend request (404): Spend request not found',
      );
    });

    it('throws on 409 terminal state', async () => {
      mockFetchResponse(409, {
        error: {
          message:
            'Spend request is in a terminal state and cannot be canceled',
        },
      });

      await expect(repo.cancel('si_123')).rejects.toThrow(
        'Failed to cancel spend request (409): Spend request is in a terminal state and cannot be canceled',
      );
    });

    it('throws on 422 expired', async () => {
      mockFetchResponse(422, {
        error: { message: 'Spend request expired' },
      });

      await expect(repo.cancel('si_123')).rejects.toThrow(
        'Failed to cancel spend request (422): Spend request expired',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.cancel('si_123')).rejects.toThrow(
        'Missing access token',
      );
    });
  });

  describe('getSpendRequest', () => {
    it('sends GET to retrieve endpoint', async () => {
      mockFetchResponse(200, spendRequestResponse);

      await repo.retrieve('si_123');

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests/si_123');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
    });

    it('returns SpendRequest on success', async () => {
      mockFetchResponse(200, spendRequestResponse);

      const result = await repo.retrieve('si_123');

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
          number: '4000009990001984',
        },
      };
      mockFetchResponse(200, approvedResponse);

      const result = await repo.retrieve('si_123');

      expect(result?.status).toBe('approved');
      expect(result?.card).toEqual({
        id: 'card_001',
        brand: 'Visa',
        exp_month: 12,
        exp_year: 2027,
        number: '4000009990001984',
      });
    });

    it('returns metadata when present in the response', async () => {
      mockFetchResponse(200, {
        ...spendRequestResponse,
        metadata: { order_id: 'ord_123', team: 'growth' },
      });

      const result = await repo.retrieve('si_123');

      expect(result?.metadata).toEqual({
        order_id: 'ord_123',
        team: 'growth',
      });
    });

    it('accepts a sparse response', async () => {
      mockFetchResponse(200, sparseSpendRequestResponse);

      await expect(repo.retrieve('si_sparse')).resolves.toEqual(
        sparseSpendRequestResponse,
      );
    });

    it('normalizes legacy string shared_payment_token to object form', async () => {
      mockFetchResponse(200, {
        ...spendRequestResponse,
        status: 'approved',
        credential_type: 'shared_payment_token',
        shared_payment_token: 'spt_legacy123',
      });

      const result = await repo.retrieve('si_123');

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

      const result = await repo.retrieve('si_123');

      expect(result?.shared_payment_token).toEqual(sptObj);
    });

    it('returns null on 404', async () => {
      mockFetchResponse(404, {});

      const result = await repo.retrieve('si_nonexistent');

      expect(result).toBeNull();
    });

    it('throws on other HTTP errors', async () => {
      mockFetchResponse(500, { error: { message: 'Internal server error' } });

      await expect(repo.retrieve('si_123')).rejects.toThrow(
        'Failed to retrieve spend request (500): Internal server error',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.retrieve('si_123')).rejects.toThrow(
        'Missing access token',
      );
    });
  });

  describe('listSpendRequests', () => {
    it('sends GET to correct endpoint with Bearer auth header', async () => {
      mockFetchResponse(200, { data: [spendRequestResponse] });

      await repo.list();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.link.com/spend_requests');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(opts.body).toBeUndefined();
    });

    it('returns array of SpendRequests unwrapped from data envelope', async () => {
      const requests = [
        { ...spendRequestResponse, id: 'si_001', status: 'approved' },
        { ...spendRequestResponse, id: 'si_002', status: 'pending_approval' },
        { ...spendRequestResponse, id: 'si_003', status: 'created' },
      ];
      mockFetchResponse(200, { data: requests });

      const result = await repo.list();

      expect(result).toHaveLength(3);
      expect(result[0]!.id).toBe('si_001');
      expect(result[1]!.id).toBe('si_002');
      expect(result[2]!.id).toBe('si_003');
    });

    it('accepts sparse spend requests in the response', async () => {
      mockFetchResponse(200, { data: [sparseSpendRequestResponse] });

      await expect(repo.list()).resolves.toEqual([sparseSpendRequestResponse]);
    });

    it('returns empty array when no active spend requests', async () => {
      mockFetchResponse(200, { data: [] });

      const result = await repo.list();

      expect(result).toEqual([]);
    });

    it('throws on HTTP error with message from body', async () => {
      mockFetchResponse(403, { error: { message: 'Forbidden' } });

      await expect(repo.list()).rejects.toThrow(
        'Failed to list spend requests (403): Forbidden',
      );
    });

    it('throws when no access token is available', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Missing access token'));

      await expect(repo.list()).rejects.toThrow('Missing access token');
    });
  });
});

describe('getDuplicateSpendRequest', () => {
  const duplicate = {
    id: 'si_duplicate',
    status: 'created',
    amount: 5000,
    currency: 'usd',
    merchant_name: 'Test Store',
    context: 'buying a widget',
    payment_details: 'pd_test123',
    line_items: [],
    totals: [],
    created_at: '2026-03-10T00:00:00Z',
    updated_at: '2026-03-10T00:00:00Z',
  };

  it('extracts the duplicate spend request from a rate-limited error', () => {
    const err = new LinkApiError('Failed to create spend request (429): ...', {
      status: 429,
      details: {
        error: {
          code: 'spend_request_rate_limited',
          message: 'You cannot submit duplicate spend requests...',
          retry_after: 1699999999,
          duplicate_spend_request: duplicate,
        },
      },
    });

    expect(getDuplicateSpendRequest(err)).toEqual(duplicate);
  });

  it('extracts a sparse duplicate spend request', () => {
    const err = new LinkApiError('Failed to create spend request (429): ...', {
      status: 429,
      details: {
        error: {
          code: 'spend_request_rate_limited',
          duplicate_spend_request: sparseSpendRequestResponse,
        },
      },
    });

    expect(getDuplicateSpendRequest(err)).toEqual(sparseSpendRequestResponse);
  });

  it('normalizes a legacy string shared_payment_token on the duplicate', () => {
    const err = new LinkApiError('Failed to create spend request (429): ...', {
      status: 429,
      details: {
        error: {
          code: 'spend_request_rate_limited',
          duplicate_spend_request: {
            ...duplicate,
            credential_type: 'shared_payment_token',
            shared_payment_token: 'spt_legacy',
          },
        },
      },
    });

    expect(getDuplicateSpendRequest(err)?.shared_payment_token).toEqual({
      id: 'spt_legacy',
    });
  });

  it('returns null when the error carries no duplicate', () => {
    const err = new LinkApiError('Failed to create spend request (429): ...', {
      status: 429,
      details: {
        error: { code: 'spend_request_rate_limited', retry_after: 123 },
      },
    });

    expect(getDuplicateSpendRequest(err)).toBeNull();
  });

  it('returns null for a non-LinkApiError', () => {
    expect(getDuplicateSpendRequest(new Error('boom'))).toBeNull();
    expect(getDuplicateSpendRequest(undefined)).toBeNull();
  });
});
