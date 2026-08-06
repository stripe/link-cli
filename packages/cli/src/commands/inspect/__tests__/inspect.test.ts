import { describe, expect, it, vi } from 'vitest';
import { runInspect } from '../inspect';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

function ucpProfile(): Record<string, unknown> {
  return {
    signing_keys: [{ kty: 'EC', kid: 'key1' }],
    ucp: {
      version: '2026-04-08',
      merchant: 'Prompt Shop',
      description: 'Drop-in system prompts for AI agents.',
      services: {
        'dev.ucp.shopping': [
          {
            version: '2026-04-08',
            transport: 'mcp',
            endpoint: 'https://shop.example.com/api/ucp/mcp',
          },
          {
            version: '2026-04-08',
            transport: 'rest',
            endpoint: 'https://shop.example.com/api/ucp',
          },
        ],
      },
      capabilities: {
        'dev.ucp.shopping.catalog.search': [
          {
            version: '2026-04-08',
            endpoint: 'https://shop.example.com/api/ucp/catalog',
          },
        ],
        'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
      },
      payment_handlers: {
        'com.stripe.payments': [
          { id: 'stripe_payments', version: '2026-06-25' },
        ],
      },
    },
  };
}

function mppSpec(methods: string[]): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    paths: {
      '/api/thing': {
        get: {
          operationId: 'getThing',
          'x-payment-info': {
            offers: methods.map((method) => ({
              method,
              intent: 'charge',
              amount: '100',
              currency: 'usd',
            })),
          },
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  };
}

// Mirrors climate.stripe.dev's shape: a `protocols`-only x-payment-info block
// with no per-method `offers` breakdown, so stripe support can only be
// confirmed by a live 402 probe of the operation.
function protocolsOnlySpec(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Contribution API',
      version: '1.0.0',
      description: 'Contribute to fund carbon removal.',
      guidance: "POST an 'amount' field (cents) to /api/contribute.",
    },
    paths: {
      '/api/contribute': {
        post: {
          operationId: 'contribute',
          'x-payment-info': { protocols: ['mpp', 'x402'] },
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amount'],
                  properties: { amount: { type: 'integer' } },
                },
              },
            },
          },
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  };
}

function encodeStripeRequest(request: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(request)).toString('base64');
}

function stripeChallengeHeader(networkId: string): string {
  return [
    'Payment id="ch_001",',
    'realm="shop.example.com",',
    'method="stripe",',
    'intent="charge",',
    `request="${encodeStripeRequest({
      amount: '100',
      currency: 'usd',
      methodDetails: { networkId, paymentMethodTypes: ['card'] },
    })}"`,
  ].join(' ');
}

describe('runInspect', () => {
  it('recommends ucp when a UCP profile is present', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/ucp')) {
        return jsonResponse(ucpProfile());
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.hostname).toBe('shop.example.com');
    expect(result.recommendation.strategy).toBe('ucp');
    expect(result.recommendation.credential_type).toBeNull();
    expect(result.strategies.find((s) => s.name === 'ucp')?.detected).toBe(
      true,
    );
    expect(result.strategies[0].name).toBe('ucp');
    expect(result._next).toEqual({
      command: 'ucp discover --business https://shop.example.com',
      description: 'Confirm UCP capabilities for this merchant',
    });
  });

  it('surfaces the UCP profile (merchant, services, capabilities, payment handlers) in the recommendation', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/ucp')) {
        return jsonResponse(ucpProfile());
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.probes.ucp.merchant).toBe('Prompt Shop');
    expect(result.probes.ucp.services).toEqual([
      {
        service: 'dev.ucp.shopping',
        version: '2026-04-08',
        transport: 'mcp',
        endpoint: 'https://shop.example.com/api/ucp/mcp',
      },
      {
        service: 'dev.ucp.shopping',
        version: '2026-04-08',
        transport: 'rest',
        endpoint: 'https://shop.example.com/api/ucp',
      },
    ]);
    expect(result.probes.ucp.capabilities).toEqual([
      {
        capability: 'dev.ucp.shopping.catalog.search',
        version: '2026-04-08',
        endpoint: 'https://shop.example.com/api/ucp/catalog',
      },
      {
        capability: 'dev.ucp.shopping.checkout',
        version: '2026-04-08',
        endpoint: undefined,
      },
    ]);
    expect(result.probes.ucp.payment_handlers).toEqual([
      {
        handler: 'com.stripe.payments',
        id: 'stripe_payments',
        version: '2026-06-25',
      },
    ]);

    const ucpStrategy = result.strategies.find((s) => s.name === 'ucp');
    expect(ucpStrategy?.evidence[0]).toMatch(/"Prompt Shop"/);
    expect(ucpStrategy?.evidence[0]).toMatch(/2 services, 2 capabilities/);

    expect(result.recommendation.profile).toEqual({
      profile_url: 'https://shop.example.com/.well-known/ucp',
      merchant: 'Prompt Shop',
      description: 'Drop-in system prompts for AI agents.',
      services: result.probes.ucp.services,
      capabilities: result.probes.ucp.capabilities,
      payment_handlers: result.probes.ucp.payment_handlers,
    });
  });

  it('recommends shared_payment_token when the MPP spec offers the "stripe" method', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(mppSpec(['tempo', 'stripe']));
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.recommendation.strategy).toBe('shared_payment_token');
    expect(result.recommendation.credential_type).toBe('shared_payment_token');
    expect(result._next).toBeUndefined();
    const mppOpenapi = result.probes.mpp_openapi;
    expect(mppOpenapi[0].url).toBe('https://shop.example.com/api/openapi.json');
    expect(mppOpenapi[0].found).toBe(true);
    expect(mppOpenapi[0].offers_stripe).toBe(true);
    expect(mppOpenapi[0].offered_methods).toEqual(['tempo', 'stripe']);
    expect(mppOpenapi).toHaveLength(1);
  });

  it('falls back to /openapi.json when /api/openapi.json is missing', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return notFound();
      }
      if (url.endsWith('/openapi.json')) {
        return jsonResponse(mppSpec(['stripe']));
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const mppOpenapi = result.probes.mpp_openapi;
    expect(mppOpenapi).toHaveLength(2);
    expect(mppOpenapi[1].url).toBe('https://shop.example.com/openapi.json');
    expect(mppOpenapi[1].found).toBe(true);
    expect(result.recommendation.strategy).toBe('shared_payment_token');
  });

  it('does not recommend shared_payment_token when the MPP spec only offers crypto rails', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(mppSpec(['tempo', 'evm', 'solana']));
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const mppOpenapi = result.probes.mpp_openapi;
    expect(mppOpenapi[0].found).toBe(true);
    expect(mppOpenapi[0].offers_stripe).toBe(false);
    expect(mppOpenapi[0].offered_methods).toEqual(['tempo', 'evm', 'solana']);

    const sptStrategy = result.strategies.find(
      (s) => s.name === 'shared_payment_token',
    );
    expect(sptStrategy?.detected).toBe(false);
    expect(sptStrategy?.evidence[0]).toMatch(
      /does not explicitly declare the "stripe" payment method/,
    );
    expect(result.recommendation.strategy).toBe('card');
  });

  it('includes the operation to call when shared_payment_token is recommended', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(mppSpec(['tempo', 'stripe']));
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.recommendation.operation).toEqual({
      path: '/api/thing',
      method: 'GET',
      description: undefined,
      request_body_schema: undefined,
    });
  });

  it('falls back to a live 402 probe when the spec only declares coarse protocols (no per-method offers)', async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(protocolsOnlySpec());
      }
      if (url === 'https://climate.stripe.dev/api/contribute') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ amount: 1 }));
        return new Response('Payment required', {
          status: 402,
          headers: {
            'WWW-Authenticate': stripeChallengeHeader('network_abc'),
          },
        });
      }
      return notFound();
    });

    const result = await runInspect(
      'https://climate.stripe.dev/api/contribute',
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    expect(result.probes.mpp_openapi[0].offers_stripe).toBe(false);
    expect(result.probes.live_challenge).toMatchObject({
      attempted: true,
      method: 'POST',
      status: 402,
      found: true,
      network_id: 'network_abc',
    });

    const sptStrategy = result.strategies.find(
      (s) => s.name === 'shared_payment_token',
    );
    expect(sptStrategy?.detected).toBe(true);
    expect(sptStrategy?.evidence.some((e) => e.includes('network_abc'))).toBe(
      true,
    );
    expect(result.recommendation.strategy).toBe('shared_payment_token');
    expect(result.recommendation.operation).toMatchObject({
      path: '/api/contribute',
      method: 'POST',
    });
  });

  it('does not attempt a live probe when the spec already declares a stripe offer', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(mppSpec(['stripe']));
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.probes.live_challenge.attempted).toBe(false);
  });

  it('detects the Link Pay Token steering block in page HTML', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse(
          '<div class="AiAgentPaymentSteering" style="display:none"></div>',
        );
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.recommendation.strategy).toBe('link_pay_token');
    expect(result.recommendation.credential_type).toBe('card');
    expect(result.probes.link_pay_token.found).toBe(true);
    expect(result.probes.link_pay_token.indicators).toContain(
      'Page HTML includes the "AiAgentPaymentSteering" component',
    );
  });

  it('falls back to card when nothing is detected', async () => {
    const fetchImpl = vi.fn(async () => notFound());

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.recommendation.strategy).toBe('card');
    expect(result.recommendation.credential_type).toBe('card');
    expect(result.strategies.find((s) => s.name === 'card')?.detected).toBe(
      true,
    );
  });

  it('treats non-JSON responses at well-known endpoints as not found', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/x402.json')) {
        return htmlResponse('<html>not json</html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.probes.x402.found).toBe(false);
    expect(result.probes.x402.error).toMatch(/not valid JSON/);
  });

  it('sanitizes ANSI escape sequences found in remote content', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse(
          '<div class="AiAgentPaymentSteering">' +
            '\x1b[31mmalicious\x1b[0m' +
            '</div>',
        );
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('\x1b');
  });

  it('rejects an invalid URL', async () => {
    await expect(runInspect('not-a-url')).rejects.toThrow(/Invalid URL/);
  });
});
