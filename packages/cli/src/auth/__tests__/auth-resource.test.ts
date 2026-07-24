import { hostname } from 'node:os';
import {
  LinkApiError,
  LinkAuthorizationDeclinedError,
  LinkTransportError,
} from '@stripe/link-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkAuthResource } from '../auth-resource';

const mockFetch = vi.fn();

function mockFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  });
}

function createResource() {
  return new LinkAuthResource({
    fetch: mockFetch,
    authBaseUrl: 'https://auth.test',
  });
}

describe('LinkAuthResource', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('initiateDeviceAuth', () => {
    it('returns device auth request on success', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://link.com/verify',
        verification_uri_complete: 'https://link.com/verify?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });

      const resource = createResource();
      const result = await resource.initiateDeviceAuth();

      expect(result).toEqual({
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        verification_url: 'https://link.com/verify',
        verification_url_complete: 'https://link.com/verify?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith('https://auth.test/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('client_id='),
      });
    });

    it('uses the default scope when none is provided', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://link.com/verify',
        verification_uri_complete: 'https://link.com/verify?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });

      const resource = createResource();
      await resource.initiateDeviceAuth();

      const body = mockFetch.mock.calls[0][1].body as string;
      const params = new URLSearchParams(body);
      expect(params.get('scope')).toBe('userinfo:read payment_methods.agentic');
    });

    it('passes a custom scope when provided', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://link.com/verify',
        verification_uri_complete: 'https://link.com/verify?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });

      const resource = createResource();
      await resource.initiateDeviceAuth({
        scope: 'userinfo:read spend_requests:approve',
      });

      const body = mockFetch.mock.calls[0][1].body as string;
      const params = new URLSearchParams(body);
      expect(params.get('scope')).toBe('userinfo:read spend_requests:approve');
      expect(params.get('authorization_details')).toBeNull();
    });

    it('passes source actions via authorization_details', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://link.com/verify',
        verification_uri_complete: 'https://link.com/verify?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });

      const resource = createResource();
      await resource.initiateDeviceAuth({
        scope: 'userinfo:read payment_methods.agentic',
        sourceActions: ['read_source_details', 'read_balances'],
      });

      const body = mockFetch.mock.calls[0][1].body as string;
      const params = new URLSearchParams(body);
      expect(params.get('scope')).toBe('userinfo:read payment_methods.agentic');
      expect(params.get('authorization_details')).toBeNull();
      expect(params.getAll('authorization_details[][type]')).toEqual([
        'source',
      ]);
      expect(params.getAll('authorization_details[][actions][]')).toEqual([
        'read_source_details',
        'read_balances',
      ]);
    });

    it('serializes freeform authorization_details after source actions', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://link.com/verify',
        verification_uri_complete: 'https://link.com/verify?code=ABCD-EFGH',
        expires_in: 900,
        interval: 5,
      });

      const resource = createResource();
      await resource.initiateDeviceAuth({
        scope: 'userinfo:read payment_methods.agentic',
        sourceActions: ['read_link_transactions'],
        authorizationDetails: [
          {
            type: 'account',
            filters: ['current', { include_inactive: true }],
          },
          true,
        ],
      });

      const body = mockFetch.mock.calls[0][1].body as string;
      const params = new URLSearchParams(body);
      expect(params.get('authorization_details')).toBeNull();
      expect(params.getAll('authorization_details[][type]')).toEqual([
        'source',
        'account',
      ]);
      expect(params.getAll('authorization_details[][actions][]')).toEqual([
        'read_link_transactions',
      ]);
      expect(params.getAll('authorization_details[][filters][]')).toEqual([
        'current',
      ]);
      expect(
        params.getAll('authorization_details[][filters][][include_inactive]'),
      ).toEqual(['true']);
      expect(params.getAll('authorization_details[]')).toEqual(['true']);
    });

    it('includes client name and hostname in connection_label', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'ABCD',
        verification_uri: 'https://link.com/verify',
        verification_uri_complete: 'https://link.com/verify?code=ABCD',
        expires_in: 900,
        interval: 5,
      });

      const resource = createResource();
      await resource.initiateDeviceAuth({ clientName: 'My Agent' });

      const body = mockFetch.mock.calls[0][1].body as string;
      const params = new URLSearchParams(body);
      expect(params.get('connection_label')).toBe(`My Agent on ${hostname()}`);
      expect(params.get('client_hint')).toBe('My Agent');
    });

    it('throws LinkApiError on non-2xx response', async () => {
      mockFetchResponse(400, {
        error: 'invalid_client',
        error_description: 'Unknown client',
      });

      const resource = createResource();
      await expect(resource.initiateDeviceAuth()).rejects.toThrow(LinkApiError);
      await expect(resource.initiateDeviceAuth()).rejects.toThrow(
        /Device auth initiation failed/,
      );
    });

    it('throws LinkTransportError when fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const resource = createResource();
      await expect(resource.initiateDeviceAuth()).rejects.toThrow(
        LinkTransportError,
      );
    });
  });

  describe('pollDeviceAuth', () => {
    it('returns tokens on success', async () => {
      mockFetchResponse(200, {
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const resource = createResource();
      const result = await resource.pollDeviceAuth('dev_123');

      expect(result).toEqual({
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    });

    it('returns scope and authorization_details when present', async () => {
      mockFetchResponse(200, {
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'userinfo:read',
        authorization_details: [{ type: 'source', actions: ['read'] }],
      });

      const resource = createResource();
      const result = await resource.pollDeviceAuth('dev_123');

      expect(result).toEqual({
        access_token: 'at_123',
        refresh_token: 'rt_456',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'userinfo:read',
        authorization_details: [{ type: 'source', actions: ['read'] }],
      });
    });

    it('returns null when authorization is pending', async () => {
      mockFetchResponse(400, { error: 'authorization_pending' });

      const resource = createResource();
      expect(await resource.pollDeviceAuth('dev_123')).toBeNull();
    });

    it('returns null on slow_down', async () => {
      mockFetchResponse(400, { error: 'slow_down' });

      const resource = createResource();
      expect(await resource.pollDeviceAuth('dev_123')).toBeNull();
    });

    it('throws on expired_token', async () => {
      mockFetchResponse(400, { error: 'expired_token' });

      const resource = createResource();
      await expect(resource.pollDeviceAuth('dev_123')).rejects.toThrow(
        LinkApiError,
      );
      await expect(resource.pollDeviceAuth('dev_123')).rejects.toThrow(
        /Device code expired/,
      );
    });

    it('throws on access_denied', async () => {
      mockFetchResponse(400, { error: 'access_denied' });

      const resource = createResource();
      await expect(resource.pollDeviceAuth('dev_123')).rejects.toThrow(
        LinkApiError,
      );
      await expect(resource.pollDeviceAuth('dev_123')).rejects.toThrow(
        /Authorization denied/,
      );
    });

    it('throws on unexpected error', async () => {
      mockFetchResponse(500, {
        error: 'server_error',
        error_description: 'Internal error',
      });

      const resource = createResource();
      await expect(resource.pollDeviceAuth('dev_123')).rejects.toThrow(
        LinkApiError,
      );
      await expect(resource.pollDeviceAuth('dev_123')).rejects.toThrow(
        /Token poll failed/,
      );
    });
  });

  describe('revokeToken', () => {
    it('sends POST to /device/revoke with client_id and token', async () => {
      mockFetchResponse(200, {});

      const resource = createResource();
      await resource.revokeToken('rt_to_revoke');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://auth.test/device/revoke');
      expect(opts.method).toBe('POST');

      const params = new URLSearchParams(opts.body as string);
      expect(params.get('client_id')).toBe('lwlpk_U7Qy7ThG69STZk');
      expect(params.get('token')).toBe('rt_to_revoke');
    });

    it('resolves on 200 success', async () => {
      mockFetchResponse(200, {});

      const resource = createResource();
      await expect(resource.revokeToken('rt_valid')).resolves.toBeUndefined();
    });

    it('throws LinkApiError on non-2xx response', async () => {
      mockFetchResponse(400, {
        error: 'invalid_client',
        error_description: 'invalid client_id',
      });

      const resource = createResource();
      await expect(resource.revokeToken('rt_bad')).rejects.toThrow(
        LinkApiError,
      );
      await expect(resource.revokeToken('rt_bad')).rejects.toThrow(
        /Token revocation failed/,
      );
    });

    it('throws LinkTransportError when fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const resource = createResource();
      await expect(resource.revokeToken('rt_bad')).rejects.toThrow(
        LinkTransportError,
      );
    });
  });

  describe('refreshToken', () => {
    it('returns new tokens on success', async () => {
      mockFetchResponse(200, {
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const resource = createResource();
      const result = await resource.refreshToken('rt_old');

      expect(result).toEqual({
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    });

    it('returns scope and authorization_details when present', async () => {
      mockFetchResponse(200, {
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'userinfo:read',
        authorization_details: [{ type: 'source', actions: ['read'] }],
      });

      const resource = createResource();
      const result = await resource.refreshToken('rt_old');

      expect(result).toEqual({
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'userinfo:read',
        authorization_details: [{ type: 'source', actions: ['read'] }],
      });
    });

    it('throws LinkApiError on failure', async () => {
      mockFetchResponse(401, {
        error: 'invalid_grant',
        error_description: 'Refresh token expired',
      });

      const resource = createResource();
      await expect(resource.refreshToken('rt_old')).rejects.toThrow(
        LinkApiError,
      );
      await expect(resource.refreshToken('rt_old')).rejects.toThrow(
        /Token refresh failed/,
      );
    });
  });
});
