import { resolveLinkSdkConfig } from '@/config';
import { describe, expect, it, vi } from 'vitest';

function captureHeaders(
  fetchSpy: ReturnType<typeof vi.fn>,
): Headers | Record<string, string> {
  const [, init] = fetchSpy.mock.calls[0]! as [unknown, RequestInit];
  return init.headers as Headers | Record<string, string>;
}

describe('resolveLinkSdkConfig', () => {
  describe('defaultHeaders', () => {
    it('injects default headers on every request', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ status: 200, text: async () => '{}' });
      const config = resolveLinkSdkConfig({
        accessToken: 'test_token',
        fetch: mockFetch,
        defaultHeaders: {
          'User-Agent': 'link-cli/0.1.0',
        },
      });

      await config.fetch?.('https://example.com', {
        method: 'GET',
        headers: {},
      });

      const headers = captureHeaders(mockFetch) as Headers;
      expect(headers.get('User-Agent')).toBe('link-cli/0.1.0');
    });

    it('does not override headers already set by the caller', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ status: 200, text: async () => '{}' });
      const config = resolveLinkSdkConfig({
        accessToken: 'test_token',
        fetch: mockFetch,
        defaultHeaders: { 'User-Agent': 'link-cli/0.1.0' },
      });

      await config.fetch?.('https://example.com', {
        method: 'GET',
        headers: { 'User-Agent': 'custom-agent' },
      });

      const headers = captureHeaders(mockFetch) as Headers;
      expect(headers.get('User-Agent')).toBe('custom-agent');
    });

    it('does not wrap fetch when defaultHeaders is not provided', () => {
      const mockFetch = vi.fn();
      const config = resolveLinkSdkConfig({
        accessToken: 'test_token',
        fetch: mockFetch,
      });

      expect(config.fetch).toBe(mockFetch);
    });

    it('does not wrap fetch when defaultHeaders is empty', () => {
      const mockFetch = vi.fn();
      const config = resolveLinkSdkConfig({
        accessToken: 'test_token',
        fetch: mockFetch,
        defaultHeaders: {},
      });

      expect(config.fetch).toBe(mockFetch);
    });
  });

  describe('credentials', () => {
    it('uses a fixed access token without enabling refresh', async () => {
      const config = resolveLinkSdkConfig({ accessToken: 'test_token' });

      expect(await config.getAccessToken()).toBe('test_token');
      expect(config.canRefreshAccessToken).toBe(false);
    });

    it('uses a token provider and enables refresh', () => {
      const getAccessToken = vi.fn(() => 'test_token');
      const config = resolveLinkSdkConfig({ getAccessToken });

      expect(config.getAccessToken).toBe(getAccessToken);
      expect(config.canRefreshAccessToken).toBe(true);
    });

    it('rejects missing, empty, or conflicting credentials', () => {
      expect(() =>
        resolveLinkSdkConfig({} as Parameters<typeof resolveLinkSdkConfig>[0]),
      ).toThrow('Pass `accessToken` or `getAccessToken`');
      expect(() => resolveLinkSdkConfig({ accessToken: '  ' })).toThrow(
        '`accessToken` cannot be empty',
      );
      expect(() =>
        resolveLinkSdkConfig({
          accessToken: 'test_token',
          getAccessToken: () => 'other_token',
        } as unknown as Parameters<typeof resolveLinkSdkConfig>[0]),
      ).toThrow('not both');
    });
  });
});
