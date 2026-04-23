import { resolveLinkSdkConfig } from '@/config';
import { describe, expect, it, vi } from 'vitest';

function captureHeaders(
  fetchSpy: ReturnType<typeof vi.fn>,
): Headers | Record<string, string> {
  const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
  return init.headers as Headers | Record<string, string>;
}

describe('resolveLinkSdkConfig', () => {
  describe('defaultHeaders', () => {
    it('injects default headers on every request', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ status: 200, text: async () => '{}' });
      const config = resolveLinkSdkConfig({
        fetch: mockFetch,
        defaultHeaders: {
          'User-Agent': 'link-cli/0.0.1 (build 42)',
          'X-Build-Number': '42',
        },
      });

      await config.fetch?.('https://example.com', {
        method: 'GET',
        headers: {},
      });

      const headers = captureHeaders(mockFetch) as Headers;
      expect(headers.get('User-Agent')).toBe('link-cli/0.0.1 (build 42)');
      expect(headers.get('X-Build-Number')).toBe('42');
    });

    it('does not override headers already set by the caller', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ status: 200, text: async () => '{}' });
      const config = resolveLinkSdkConfig({
        fetch: mockFetch,
        defaultHeaders: { 'User-Agent': 'link-cli/0.0.1 (build 42)' },
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
      const config = resolveLinkSdkConfig({ fetch: mockFetch });

      expect(config.fetch).toBe(mockFetch);
    });

    it('does not wrap fetch when defaultHeaders is empty', () => {
      const mockFetch = vi.fn();
      const config = resolveLinkSdkConfig({
        fetch: mockFetch,
        defaultHeaders: {},
      });

      expect(config.fetch).toBe(mockFetch);
    });
  });
});
