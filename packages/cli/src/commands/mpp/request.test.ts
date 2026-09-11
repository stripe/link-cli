import { describe, expect, it, vi } from 'vitest';
import { createMppRequest, probeMppRequest } from './request';

function response(status: number, location?: string): Response {
  return new Response('response body', {
    status,
    headers: location ? { location } : undefined,
  });
}

describe('probeMppRequest', () => {
  it('preserves method and body across 307 while stripping cross-origin credentials', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(307, 'https://merchant.example/pay'))
      .mockResolvedValueOnce(response(402));
    const request = createMppRequest(
      'https://redirector.example/start',
      'PUT',
      'payload',
      {
        Authorization: 'Bearer secret',
        'Content-Type': 'text/plain',
      },
    );

    const result = await probeMppRequest(request, fetcher);

    expect(result.method).toBe('PUT');
    expect(result.body).toBe('payload');
    expect(result.headers.get('authorization')).toBeNull();
    expect(result.headers.get('content-type')).toBe('text/plain');
  });

  it('turns PUT into GET on a same-origin 303 and drops body headers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(303, '/challenge'))
      .mockResolvedValueOnce(response(402));
    const request = createMppRequest(
      'https://merchant.example/start',
      'PUT',
      'payload',
      {
        Authorization: 'Bearer caller-value',
        'Content-Type': 'text/plain',
      },
    );

    const result = await probeMppRequest(request, fetcher);

    expect(result.url).toBe('https://merchant.example/challenge');
    expect(result.method).toBe('GET');
    expect(result.body).toBeUndefined();
    expect(result.headers.get('content-type')).toBeNull();
    expect(result.headers.get('authorization')).toBe('Bearer caller-value');
  });

  it('rejects remote HTTP and HTTPS downgrade redirects', async () => {
    expect(() =>
      createMppRequest('http://merchant.example/pay', 'GET', undefined, {}),
    ).toThrow(/require HTTPS/);

    const redirected = response(302, 'http://127.0.0.1:8080/pay');
    const fetcher = vi.fn().mockResolvedValue(redirected);
    const request = createMppRequest(
      'https://merchant.example/start',
      'GET',
      undefined,
      {},
    );

    await expect(probeMppRequest(request, fetcher)).rejects.toThrow(
      /HTTPS downgrade/,
    );
    expect(redirected.bodyUsed).toBe(true);
  });
});
