import { LinkApiError, LinkTransportError } from '@/errors';
import type { CreateReportParams, ReportRecord } from '@/resources/interfaces';
import { ReportResource } from '@/resources/report';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
const getAccessToken = vi.fn();

function mockFetchResponse(status: number, body: object) {
  mockFetch.mockResolvedValue({
    status,
    text: async () => JSON.stringify(body),
  });
}

const validParams: CreateReportParams = {
  domain: 'merchant.com',
  outcome: 'blocked',
  spend_request_id: 'lsrq_test123',
  tags: ['captcha', 'cdn_block'],
  step: 'checkout payment form',
  freeform_context: 'Challenge appeared after clicking Place Order',
};

const successResponse: ReportRecord = {
  object: 'agent_report',
  created_at: '2026-05-20T18:30:00Z',
  domain: 'merchant.com',
  outcome: 'blocked',
  spend_request_id: 'lsrq_test123',
  status: 'received',
};

describe('ReportResource', () => {
  let resource: ReportResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    getAccessToken.mockResolvedValue('test_token');
    resource = new ReportResource({ getAccessToken });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('create', () => {
    it('sends POST to /agent_observations with JSON body and Bearer auth', async () => {
      mockFetchResponse(201, successResponse);

      await resource.create(validParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.link.com/agent_observations');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers.Authorization).toBe('Bearer test_token');
      expect(JSON.parse(opts.body)).toEqual(validParams);
    });

    it('returns the report record on success', async () => {
      mockFetchResponse(201, successResponse);

      const result = await resource.create(validParams);

      expect(result).toEqual(successResponse);
    });

    it('works with only required params', async () => {
      mockFetchResponse(201, successResponse);

      await resource.create({
        domain: 'shop.example.com',
        outcome: 'success',
        spend_request_id: 'lsrq_minimal',
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.domain).toBe('shop.example.com');
      expect(body.outcome).toBe('success');
      expect(body.spend_request_id).toBe('lsrq_minimal');
      expect(body.tags).toBeUndefined();
      expect(body.step).toBeUndefined();
      expect(body.freeform_context).toBeUndefined();
    });

    it('retries with refreshed token on 401', async () => {
      mockFetch
        .mockResolvedValueOnce({ status: 401, text: async () => '{}' })
        .mockResolvedValueOnce({
          status: 201,
          text: async () => JSON.stringify(successResponse),
        });
      getAccessToken
        .mockResolvedValueOnce('expired_token')
        .mockResolvedValueOnce('fresh_token');

      const result = await resource.create(validParams);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, secondOpts] = mockFetch.mock.calls[1];
      expect(secondOpts.headers.Authorization).toBe('Bearer fresh_token');
      expect(result).toEqual(successResponse);
    });

    it('throws LinkApiError on 400 with error message', async () => {
      mockFetchResponse(400, {
        error: {
          message: 'outcome must be one of: success, blocked, abandoned',
        },
      });

      const err = await resource.create(validParams).catch((e) => e);

      expect(err).toBeInstanceOf(LinkApiError);
      expect(err.message).toMatch('Failed to create report (400)');
      expect(err.message).toMatch('outcome must be one of');
    });

    it('throws LinkApiError on 404 when flag disabled', async () => {
      mockFetchResponse(404, { error: { message: 'Not found' } });

      const err = await resource.create(validParams).catch((e) => e);

      expect(err).toBeInstanceOf(LinkApiError);
      expect(err.message).toMatch('Failed to create report (404)');
    });

    it('throws when access token is unavailable', async () => {
      getAccessToken.mockRejectedValueOnce(new Error('Not authenticated'));

      await expect(resource.create(validParams)).rejects.toThrow(
        'Not authenticated',
      );
    });

    it('throws LinkTransportError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const err = await resource.create(validParams).catch((e) => e);

      expect(err).toBeInstanceOf(LinkTransportError);
      expect(err.message).toMatch('Request failed');
    });

    it('throws LinkApiError with raw body when error response is not structured', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const err = await resource.create(validParams).catch((e) => e);

      expect(err).toBeInstanceOf(LinkApiError);
      expect(err.message).toMatch('Failed to create report (500)');
      expect(err.message).toMatch('Internal Server Error');
    });
  });
});
