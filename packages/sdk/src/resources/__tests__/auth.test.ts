import { hostname } from 'node:os';
import { AuthResource } from '@/resources/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();

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

describe('AuthResource', () => {
  let repo: AuthResource;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    repo = new AuthResource();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initiateDeviceAuth', () => {
    it('returns a DeviceAuthRequest on success', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_123',
        user_code: 'apple-grape',
        verification_uri: 'https://app.link.com/device/setup',
        verification_uri_complete:
          'https://app.link.com/device/setup?code=apple-grape',
        expires_in: 300,
        interval: 5,
      });

      const result = await repo.initiateDeviceAuth();

      expect(result).toEqual({
        device_code: 'dev_123',
        user_code: 'apple-grape',
        verification_url: 'https://app.link.com/device/setup',
        verification_url_complete:
          'https://app.link.com/device/setup?code=apple-grape',
        expires_in: 300,
        interval: 5,
      });
    });

    it('maps verification_uri to verification_url in the response', async () => {
      mockFetchResponse(200, {
        device_code: 'dev_456',
        user_code: 'banana-kiwi',
        verification_uri: 'https://app.link.com/device/setup',
        verification_uri_complete:
          'https://app.link.com/device/setup?code=banana-kiwi',
        expires_in: 600,
        interval: 10,
      });

      const result = await repo.initiateDeviceAuth();

      expect(result.verification_url).toBe('https://app.link.com/device/setup');
      expect(result.verification_url_complete).toBe(
        'https://app.link.com/device/setup?code=banana-kiwi',
      );
    });

    it('sends correct request parameters', async () => {
      mockFetchResponse(200, {
        device_code: 'dc',
        user_code: 'uc',
        verification_uri: 'https://example.com',
        verification_uri_complete: 'https://example.com?code=uc',
        expires_in: 300,
        interval: 5,
      });

      await repo.initiateDeviceAuth();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://login.link.com/device/code');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );

      const params = new URLSearchParams(opts.body);
      expect(params.get('client_id')).toBe('lwlpk_U7Qy7ThG69STZk');
      expect(params.get('scope')).toBe('userinfo:read payment_methods.agentic');
      expect(params.get('connection_label')).toBe(`Link CLI on ${hostname()}`);
      expect(params.get('client_hint')).toBe('Link CLI');
    });

    it('uses custom clientName in connection_label and client_hint when provided', async () => {
      mockFetchResponse(200, {
        device_code: 'dc',
        user_code: 'uc',
        verification_uri: 'https://example.com',
        verification_uri_complete: 'https://example.com?code=uc',
        expires_in: 300,
        interval: 5,
      });

      const customRepo = new AuthResource({ clientName: 'Claude Code' });
      await customRepo.initiateDeviceAuth();

      const [, opts] = mockFetch.mock.calls[0];
      const params = new URLSearchParams(opts.body);
      expect(params.get('connection_label')).toBe(
        `Claude Code on ${hostname()}`,
      );
      expect(params.get('client_hint')).toBe('Claude Code');
    });

    it('uses per-call clientName override over config default', async () => {
      mockFetchResponse(200, {
        device_code: 'dc',
        user_code: 'uc',
        verification_uri: 'https://example.com',
        verification_uri_complete: 'https://example.com?code=uc',
        expires_in: 300,
        interval: 5,
      });

      await repo.initiateDeviceAuth('My Agent');

      const [, opts] = mockFetch.mock.calls[0];
      const params = new URLSearchParams(opts.body);
      expect(params.get('connection_label')).toBe(`My Agent on ${hostname()}`);
      expect(params.get('client_hint')).toBe('My Agent');
    });

    it('throws on HTTP error with error_description', async () => {
      mockFetchResponse(403, {
        error: 'forbidden',
        error_description: 'Client not authorized',
      });

      await expect(repo.initiateDeviceAuth()).rejects.toThrow(
        'Device auth initiation failed (403): Client not authorized',
      );
    });

    it('throws on HTTP error falling back to error field', async () => {
      mockFetchResponse(500, { error: 'server_error' });

      await expect(repo.initiateDeviceAuth()).rejects.toThrow(
        'Device auth initiation failed (500): server_error',
      );
    });
  });

  describe('pollDeviceAuth', () => {
    it('returns AuthTokens on success', async () => {
      mockFetchResponse(200, {
        access_token: 'at_abc',
        refresh_token: 'rt_xyz',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const result = await repo.pollDeviceAuth('dev_123');

      expect(result).toEqual({
        access_token: 'at_abc',
        refresh_token: 'rt_xyz',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    });

    it('sends correct request parameters', async () => {
      mockFetchResponse(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      await repo.pollDeviceAuth('dev_code_999');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://login.link.com/device/token');
      const params = new URLSearchParams(opts.body);
      expect(params.get('grant_type')).toBe(
        'urn:ietf:params:oauth:grant-type:device_code',
      );
      expect(params.get('device_code')).toBe('dev_code_999');
      expect(params.get('client_id')).toBe('lwlpk_U7Qy7ThG69STZk');
    });

    it('returns null on authorization_pending', async () => {
      mockFetchResponse(400, { error: 'authorization_pending' });

      const result = await repo.pollDeviceAuth('dev_123');
      expect(result).toBeNull();
    });

    it('returns null on slow_down', async () => {
      mockFetchResponse(400, { error: 'slow_down' });

      const result = await repo.pollDeviceAuth('dev_123');
      expect(result).toBeNull();
    });

    it('throws on expired_token', async () => {
      mockFetchResponse(400, { error: 'expired_token' });

      await expect(repo.pollDeviceAuth('dev_123')).rejects.toThrow(
        'Device code expired. Please restart the login flow.',
      );
    });

    it('throws on access_denied', async () => {
      mockFetchResponse(400, { error: 'access_denied' });

      await expect(repo.pollDeviceAuth('dev_123')).rejects.toThrow(
        'Authorization denied by user.',
      );
    });

    it('throws on unexpected 400 error', async () => {
      mockFetchResponse(400, {
        error: 'invalid_grant',
        error_description: 'Grant is invalid',
      });

      await expect(repo.pollDeviceAuth('dev_123')).rejects.toThrow(
        'Token poll failed (400): Grant is invalid',
      );
    });

    it('throws on server error', async () => {
      mockFetchResponse(500, { error: 'server_error' });

      await expect(repo.pollDeviceAuth('dev_123')).rejects.toThrow(
        'Token poll failed (500): server_error',
      );
    });

    it('handles non-JSON error body gracefully', async () => {
      mockFetchRawResponse(502, 'Bad Gateway');

      await expect(repo.pollDeviceAuth('dev_123')).rejects.toThrow(
        'Token poll failed (502): Bad Gateway',
      );
    });
  });

  describe('refreshToken', () => {
    it('returns new AuthTokens on success', async () => {
      mockFetchResponse(200, {
        access_token: 'new_at',
        refresh_token: 'new_rt',
        expires_in: 7200,
        token_type: 'Bearer',
      });

      const result = await repo.refreshToken('old_rt');

      expect(result).toEqual({
        access_token: 'new_at',
        refresh_token: 'new_rt',
        expires_in: 7200,
        token_type: 'Bearer',
      });
    });

    it('sends correct request parameters', async () => {
      mockFetchResponse(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      await repo.refreshToken('my_refresh_token');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://login.link.com/device/token');
      const params = new URLSearchParams(opts.body);
      expect(params.get('grant_type')).toBe('refresh_token');
      expect(params.get('refresh_token')).toBe('my_refresh_token');
      expect(params.get('client_id')).toBe('lwlpk_U7Qy7ThG69STZk');
    });

    it('throws on HTTP error with error_description', async () => {
      mockFetchResponse(401, {
        error: 'invalid_grant',
        error_description: 'Refresh token revoked',
      });

      await expect(repo.refreshToken('bad_rt')).rejects.toThrow(
        'Token refresh failed (401): Refresh token revoked',
      );
    });

    it('handles non-JSON error body gracefully', async () => {
      mockFetchRawResponse(503, 'Service Unavailable');

      await expect(repo.refreshToken('rt')).rejects.toThrow(
        'Token refresh failed (503): Service Unavailable',
      );
    });
  });
});
