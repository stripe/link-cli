import { describe, expect, it, vi } from 'vitest';
import { buildInspectUrl, runInspect } from '../inspect';
import { formatInspectFields } from '../inspect-view';
import { ENTRY } from './fixtures';

describe('Directory inspection', () => {
  it('makes one anonymous GET and preserves the full API result', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(ENTRY));
    const merchantUrl = 'https://example.com/products?a=1&b=two#details';
    const result = await runInspect(merchantUrl, {
      fetchImpl,
      userAgent: 'link-cli/1.4.1',
    });
    expect(result).toEqual(ENTRY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [request, init] = fetchImpl.mock.calls[0];
    const endpoint = new URL(String(request));
    expect(endpoint.origin).toBe('https://api.stripe.com');
    expect(endpoint.pathname).toBe('/v1/directory/inspect');
    expect(Object.fromEntries(endpoint.searchParams)).toEqual({
      url: 'example.com',
    });
    expect(init).toEqual({
      method: 'GET',
      headers: {
        'User-Agent': 'link-cli/1.4.1',
        'Stripe-Version': '2026-10-28.preview',
      },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves unknown-merchant placeholders without adding advice', async () => {
    const placeholder = {
      id: 'diren_no_entry_found',
      object: 'directory.inspect_result',
      url: 'unknown.example',
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(placeholder));
    expect(await runInspect('unknown.example', { fetchImpl })).toEqual(
      placeholder,
    );
  });

  it('sanitizes terminal control sequences in API strings', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...ENTRY,
        description: '\u001b[31mInjected\u001b[0m\r',
      }),
    );
    expect(await runInspect('example.com', { fetchImpl })).toEqual({
      ...ENTRY,
      description: 'Injected',
    });
  });

  it('surfaces API errors without fetching the merchant', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: 'Inspection unavailable' } },
          { status: 503 },
        ),
      );
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      'Inspection unavailable',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sanitizes API error messages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: '\u001b[31mUnavailable\u001b[0m' } },
          { status: 503 },
        ),
      );
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      /^Unavailable$/,
    );
  });

  it('reports non-JSON HTTP failures', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('<html>Unavailable</html>', { status: 502 }),
      );
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      'HTTP 502',
    );
  });

  it.each([
    null,
    [],
    {},
    { id: 'diren_example' },
    { url: 'example.com' },
    { ...ENTRY, object: 'unexpected' },
    { ...ENTRY, description: 42 },
    { ...ENTRY, documentation: 'https://example.com/docs' },
    { ...ENTRY, agent_integration_actions: [{ type: 42 }] },
    { ...ENTRY, suggested_payment_mechanisms: { card: { agent_tools: [] } } },
  ])('rejects a malformed success payload: %j', async (payload) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(payload));
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      'invalid response',
    );
  });

  it('rejects non-JSON success responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>Hello</html>'));
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      'invalid response',
    );
  });

  it('rejects a result for another merchant', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ ...ENTRY, url: 'another.example.com' }),
      );
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      'mismatched merchant hostname',
    );
  });

  it('preserves future action fields without treating them as supported routes', async () => {
    const payload = {
      ...ENTRY,
      agent_integration_actions: [{ type: 'future_route', extra: true }],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(payload));
    expect(await runInspect('example.com', { fetchImpl })).toEqual(payload);
  });

  it('reports network failures without falling back to local probing', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Connection failed'));
    await expect(runInspect('example.com', { fetchImpl })).rejects.toThrow(
      'Directory inspect request failed',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the timeout active while consuming the response body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_request, init) =>
        ({
          ok: true,
          status: 200,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              const signal = init?.signal;
              signal?.addEventListener('abort', () => reject(signal.reason), {
                once: true,
              });
            }),
        }) as Response,
    );
    await expect(
      runInspect('example.com', { fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow('Directory inspection timed out');
  });
});

describe('inspection input', () => {
  it.each([
    [
      'https://WWW.Example.com:8443/checkout?session=private#payment',
      'example.com',
    ],
    ['https://Shop.Example.com/cart', 'shop.example.com'],
  ])('sends only the normalized hostname for %s', (input, hostname) => {
    expect(buildInspectUrl(input).searchParams.get('url')).toBe(hostname);
  });
  it('accepts bare domains and trims surrounding whitespace', () => {
    expect(buildInspectUrl(' example.com ').searchParams.get('url')).toBe(
      'example.com',
    );
  });

  it.each([
    '',
    'not a url',
    'file:///tmp/merchant',
    'ftp://example.com',
    'mailto:someone@example.com',
    'https://user:secret@example.com',
    'http://',
    'localhost',
    'https://127.0.0.1',
    'http://[::1]/checkout',
    'https://-bad.example.com',
  ])('rejects invalid input before fetching: %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(runInspect(url, { fetchImpl })).rejects.toThrow(
      'HTTP(S) URL or merchant domain',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('interactive inspection fields', () => {
  it('includes documentation, integration actions, payment mechanisms, and extra fields', () => {
    const output = formatInspectFields(ENTRY);
    expect(output).toContain('https://example.com/docs');
    expect(output).toContain('https://example.com/api');
    expect(output).toContain('Install the merchant CLI');
    expect(output).toContain('Pay the invoice');
    expect(output).toContain('enabled: false');
    expect(output).toContain('count: 0');
    expect(output).toContain('unknown: null');
    expect(output).toContain('[]');
  });

  it('sanitizes field labels and values', () => {
    const output = formatInspectFields({ '\u001b[31mkey': '\u001b[0mvalue' });
    expect(output).toBe('key: value');
  });
});
