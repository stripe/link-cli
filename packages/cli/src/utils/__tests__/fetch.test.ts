import { describe, expect, it, vi } from 'vitest';
import { withDefaultHeaders } from '../fetch';

function captureHeaders(fetchSpy: ReturnType<typeof vi.fn>): Headers {
  const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
  return new Headers(init.headers);
}

describe('withDefaultHeaders', () => {
  it('injects default headers when the caller omitted them', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    const fetchImpl = withDefaultHeaders(mockFetch, {
      'User-Agent': 'link-cli/0.14.0 (GrokBot)',
    });

    await fetchImpl('https://merchant.example/pay', { method: 'GET' });

    expect(captureHeaders(mockFetch).get('User-Agent')).toBe(
      'link-cli/0.14.0 (GrokBot)',
    );
  });

  it('does not override a caller-supplied User-Agent', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    const fetchImpl = withDefaultHeaders(mockFetch, {
      'User-Agent': 'link-cli/0.14.0 (GrokBot)',
    });

    await fetchImpl('https://merchant.example/pay', {
      method: 'GET',
      headers: { 'User-Agent': 'CustomBot/1.0' },
    });

    expect(captureHeaders(mockFetch).get('User-Agent')).toBe('CustomBot/1.0');
  });

  it('treats header names as case-insensitive', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response());
    const fetchImpl = withDefaultHeaders(mockFetch, {
      'User-Agent': 'link-cli/0.14.0',
    });

    await fetchImpl('https://merchant.example/pay', {
      headers: { 'user-agent': 'CustomBot/1.0' },
    });

    expect(captureHeaders(mockFetch).get('User-Agent')).toBe('CustomBot/1.0');
  });
});
