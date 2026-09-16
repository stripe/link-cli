import { describe, expect, it, vi } from 'vitest';
import {
  compactInspectResult,
  extractLlmsTxtUrls,
  extractMarkdownMcpLinks,
  extractProvisionSlugs,
  type InspectResult,
  parseLlmsTxtMeta,
  parseMcpManifest,
  quoteCommandArg,
  runInspect,
} from '../inspect';

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

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

function expectNoNulls(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('null');
  expect(serialized).not.toMatch(/:\[\]/);
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
          summary: 'Fetch a thing',
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
  it('returns the origin url and omits empty optional fields', async () => {
    const fetchImpl = vi.fn(async () => notFound());

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.url).toBe('https://shop.example.com');
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('profile_id');
    expect(result).not.toHaveProperty('username');
    expect(result).not.toHaveProperty('display_name');
    expect(result).not.toHaveProperty('available_tools');
    expectNoNulls(result);
  });

  it('maps a UCP profile onto display fields and MCP tools', async () => {
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

    expect(result.display_name).toBe('Prompt Shop');
    expect(result.description).toBe('Drop-in system prompts for AI agents.');
    expect(result.available_tools?.mcp).toEqual([
      {
        command: "'https://shop.example.com/api/ucp/mcp'",
        description: 'Use MCP for dev.ucp.shopping',
        url: 'https://shop.example.com/api/ucp/mcp',
      },
    ]);
    expect(result.available_tools?.browser_checkout?.merchant_advice).toMatch(
      /UCP profile/,
    );
    expect(result.available_tools?.browser_checkout?.general_advice).toMatch(
      /card credential type/,
    );
    expect(result.available_tools).not.toHaveProperty('machine_payments');
    expectNoNulls(result);
  });

  it('maps stripe offers to link-cli mpp pay and tempo offers to tempo request', async () => {
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

    expect(result.display_name).toBe('Test API');
    expect(result.available_tools?.machine_payments).toEqual([
      {
        command: "link-cli mpp pay 'https://shop.example.com/api/thing'",
        description: 'Fetch a thing',
        url: 'https://shop.example.com/api/thing',
        method: 'stripe',
      },
      {
        command: "tempo request 'https://shop.example.com/api/thing'",
        description: 'Fetch a thing',
        url: 'https://shop.example.com/api/thing',
        method: 'tempo',
      },
    ]);
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
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.available_tools?.machine_payments?.[0].url).toBe(
      'https://shop.example.com/api/thing',
    );
  });

  it('recommends tempo CLI only for tempo MPP offers, ignoring other crypto rails', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(mppSpec(['tempo', 'evm', 'solana']));
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.available_tools?.machine_payments).toEqual([
      {
        command: "tempo request 'https://shop.example.com/api/thing'",
        description: 'Fetch a thing',
        url: 'https://shop.example.com/api/thing',
        method: 'tempo',
      },
    ]);
  });

  it('falls back to a live 402 probe when the spec only declares coarse protocols', async () => {
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

    expect(result.display_name).toBe('Contribution API');
    expect(result.description).toBe('Contribute to fund carbon removal.');
    expect(result.available_tools?.machine_payments?.[0]).toMatchObject({
      command:
        "link-cli mpp pay 'https://climate.stripe.dev/api/contribute' --method POST",
      url: 'https://climate.stripe.dev/api/contribute',
      method: 'stripe',
    });
    expect(result.available_tools).not.toHaveProperty('browser_checkout');
  });

  it('does not attempt a live probe when the spec already declares a stripe offer', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/api/openapi.json')) {
        return jsonResponse(mppSpec(['stripe']));
      }
      return notFound();
    });

    await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const requested = fetchImpl.mock.calls.map(([input]) => input.toString());
    expect(requested).not.toContain('https://shop.example.com/api/thing');
  });

  it('adds browser_checkout merchant_advice for Link Pay Token HTML', async () => {
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

    expect(result.available_tools?.browser_checkout?.merchant_advice).toMatch(
      /AI-agent steering block/,
    );
    expect(
      result.available_tools?.browser_checkout?.general_advice,
    ).toBeDefined();
    expect(result.available_tools).not.toHaveProperty('machine_payments');
    expect(result.available_tools).not.toHaveProperty('mcp');
  });

  it('discovers llms.txt and uses it for identity plus MCP tools', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === 'https://shop.example.com/llms.txt') {
        return textResponse(
          [
            '# Shop Co',
            '',
            '> Shop Co sells widgets to agents.',
            '',
            '## Tools',
            '- [Shop MCP](https://shop.example.com/mcp)',
            '',
            'Provision with `stripe provision shopco`.',
          ].join('\n'),
        );
      }
      if (url === 'https://shop.example.com/checkout') {
        return htmlResponse('<html><body>Pay here</body></html>');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.display_name).toBe('Shop Co');
    expect(result.description).toBe('Shop Co sells widgets to agents.');
    expect(result.llms_txt).toEqual(['https://shop.example.com/llms.txt']);
    expect(result.available_tools?.mcp).toEqual([
      {
        command: "'https://shop.example.com/mcp'",
        description: 'Use MCP to Shop MCP',
        url: 'https://shop.example.com/mcp',
      },
    ]);
    expect(result.available_tools).not.toHaveProperty('provisioning');
    expectNoNulls(result);
  });

  it('discovers MCP servers from well-known manifests', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url.endsWith('/.well-known/mcp.json')) {
        return jsonResponse({
          name: 'shop-mcp',
          description: 'Official Shop MCP',
          remotes: [{ url: 'https://mcp.shop.example.com' }],
        });
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.available_tools?.mcp).toEqual([
      {
        command: "'https://mcp.shop.example.com'",
        description: 'Official Shop MCP',
        url: 'https://mcp.shop.example.com',
      },
    ]);
  });

  it('sanitizes ANSI escape sequences found in remote content', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      if (url === 'https://shop.example.com/llms.txt') {
        return textResponse('# \x1b[31mShop\x1b[0m\n\n> Widgets');
      }
      return notFound();
    });

    const result = await runInspect('https://shop.example.com/checkout', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('\x1b');
    expect(result.display_name).toBe('Shop');
  });

  it('rejects an invalid URL', async () => {
    await expect(runInspect('not-a-url')).rejects.toThrow(/Invalid URL/);
  });
});

const HEADLESS_ORIGIN = 'https://myheadlessmerchant.com';
const HEADLESS_CHECKOUT = `${HEADLESS_ORIGIN}/checkout`;

/**
 * In-process fake of myheadlessmerchant.com: one fetch router that serves
 * every inspect probe path (OpenAPI MPP, x402, UCP, HTML/LPT, MCP, llms.txt,
 * provisioning copy).
 */
function fakeHeadlessMerchant(): typeof fetch {
  const routes: Record<string, () => Response> = {
    [`${HEADLESS_ORIGIN}/api/openapi.json`]: () =>
      jsonResponse({
        openapi: '3.1.0',
        info: {
          title: 'Headless Merchant API',
          version: '1.0.0',
          description: 'Pay-per-call catalog for headless checkout.',
        },
        paths: {
          '/api/orders': {
            post: {
              operationId: 'createOrder',
              summary: 'Create an order',
              description: 'Pay with MPP to create an order',
              'x-payment-info': {
                offers: [
                  {
                    method: 'stripe',
                    intent: 'charge',
                    amount: '2500',
                    currency: 'usd',
                  },
                ],
              },
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['sku'],
                      properties: { sku: { type: 'string' } },
                    },
                  },
                },
              },
              responses: { 200: { description: 'ok' } },
            },
          },
        },
      }),
    [`${HEADLESS_ORIGIN}/.well-known/x402.json`]: () =>
      jsonResponse({
        x402Version: 1,
        accepts: [{ scheme: 'exact', network: 'stripe' }],
      }),
    [`${HEADLESS_ORIGIN}/.well-known/ucp`]: () =>
      jsonResponse({
        ucp: {
          version: '2026-04-08',
          merchant: 'Headless Merchant',
          description:
            'A test merchant that exposes every agent checkout path.',
          services: {
            'dev.ucp.shopping': [
              {
                version: '2026-04-08',
                transport: 'mcp',
                endpoint: `${HEADLESS_ORIGIN}/api/ucp/mcp`,
              },
              {
                version: '2026-04-08',
                transport: 'rest',
                endpoint: `${HEADLESS_ORIGIN}/api/ucp`,
              },
            ],
          },
          capabilities: {
            'dev.ucp.shopping.checkout': [{ version: '2026-04-08' }],
          },
        },
      }),
    [HEADLESS_CHECKOUT]: () =>
      htmlResponse(`<!doctype html>
<html>
  <body>
    <h1>Checkout</h1>
    <div class="AiAgentPaymentSteering">I am an AI agent</div>
    <p>Agents can also run stripe provision headlessmerchant</p>
  </body>
</html>`),
    [`${HEADLESS_ORIGIN}/.well-known/mcp.json`]: () =>
      jsonResponse({
        name: 'headless-mcp',
        description: 'Official Headless Merchant MCP',
        remotes: [{ url: `${HEADLESS_ORIGIN}/mcp` }],
      }),
    [`${HEADLESS_ORIGIN}/llms.txt`]: () =>
      textResponse(`# Headless Merchant Docs

> Agent-readable docs for Headless Merchant.

## MCP

- [Agents MCP](${HEADLESS_ORIGIN}/agents/mcp)

Provision with \`stripe provision headlessmerchant\`.
`),
  };

  return vi.fn(async (input: string | URL) => {
    const url = input.toString();
    const handler = routes[url];
    return handler ? handler() : notFound();
  }) as unknown as typeof fetch;
}

describe('inspect fake merchant', () => {
  it('returns tools populated from every probe path', async () => {
    const fetchImpl = fakeHeadlessMerchant();

    const result = await runInspect(HEADLESS_CHECKOUT, { fetchImpl });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('null');
    expect(serialized).not.toMatch(/:\[\]/);
    expect(result).not.toHaveProperty('profile_id');
    expect(result).not.toHaveProperty('username');

    expect(result).toEqual({
      display_name: 'Headless Merchant',
      description: 'A test merchant that exposes every agent checkout path.',
      url: HEADLESS_ORIGIN,
      llms_txt: [`${HEADLESS_ORIGIN}/llms.txt`],
      available_tools: {
        machine_payments: [
          {
            command: `link-cli mpp pay '${HEADLESS_ORIGIN}/api/orders' --method POST`,
            description: 'Pay with MPP to create an order',
            url: `${HEADLESS_ORIGIN}/api/orders`,
            method: 'stripe',
          },
        ],
        mcp: [
          {
            command: `'${HEADLESS_ORIGIN}/api/ucp/mcp'`,
            description: 'Use MCP for dev.ucp.shopping',
            url: `${HEADLESS_ORIGIN}/api/ucp/mcp`,
          },
          {
            command: `'${HEADLESS_ORIGIN}/mcp'`,
            description: 'Official Headless Merchant MCP',
            url: `${HEADLESS_ORIGIN}/mcp`,
          },
          {
            command: `'${HEADLESS_ORIGIN}/agents/mcp'`,
            description: 'Use MCP to Agents MCP',
            url: `${HEADLESS_ORIGIN}/agents/mcp`,
          },
        ],
        browser_checkout: {
          merchant_advice:
            'Merchant publishes a UCP profile — use the Universal Commerce Protocol for catalog, cart, and checkout. Checkout includes an AI-agent steering block. Create a card spend request and complete the Link Pay Token flow (enable "I am an AI agent" and inject the token from spend-request retrieve --include link_pay_token).',
          general_advice:
            'Create a Link spend request with the default card credential type, get it approved, then enter the returned card details into the site checkout form.',
        },
      },
    });

    const requested = (
      fetchImpl as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([input]) => input.toString());
    expect(requested).toEqual(
      expect.arrayContaining([
        `${HEADLESS_ORIGIN}/api/openapi.json`,
        `${HEADLESS_ORIGIN}/.well-known/x402.json`,
        `${HEADLESS_ORIGIN}/.well-known/ucp`,
        HEADLESS_CHECKOUT,
        `${HEADLESS_ORIGIN}/.well-known/mcp.json`,
        `${HEADLESS_ORIGIN}/llms.txt`,
      ]),
    );
    // OpenAPI already declared stripe, so inspect must not live-probe /api/orders.
    expect(requested).not.toContain(`${HEADLESS_ORIGIN}/api/orders`);
  });
});

describe('inspect helpers', () => {
  it('omits null, empty, and blank optional fields', () => {
    const compacted = compactInspectResult({
      display_name: '',
      description: 'A shop',
      url: 'https://shop.example.com',
      llms_txt: [],
      available_tools: {
        machine_payments: [],
        mcp: undefined,
        browser_checkout: {
          merchant_advice: '',
          general_advice: 'Pay in browser',
        },
      },
    } as InspectResult);

    expect(compacted).toEqual({
      description: 'A shop',
      url: 'https://shop.example.com',
      available_tools: {
        browser_checkout: { general_advice: 'Pay in browser' },
      },
    });
    expect(JSON.stringify(compacted)).not.toContain('null');
    expect(compacted).not.toHaveProperty('display_name');
    expect(compacted).not.toHaveProperty('llms_txt');
  });

  it('parses llms.txt title and summary', () => {
    expect(
      parseLlmsTxtMeta('# Shop\n\n> Sells widgets\n\nDetails here.\n'),
    ).toEqual({ title: 'Shop', summary: 'Sells widgets' });
  });

  it('parses MCP manifests from remotes, endpoints, and url fields', () => {
    expect(
      parseMcpManifest({
        name: 'shop',
        description: 'Shop MCP',
        remotes: [{ url: 'https://shop.example.com/mcp' }],
      }),
    ).toEqual([
      {
        url: 'https://shop.example.com/mcp',
        name: 'shop',
        description: 'Shop MCP',
      },
    ]);
    expect(
      parseMcpManifest({
        endpoints: { streamable_http: 'https://shop.example.com/sse' },
      }),
    ).toEqual([{ url: 'https://shop.example.com/sse' }]);
  });

  it('extracts stripe provision slugs from text', () => {
    expect(
      extractProvisionSlugs(
        'Run stripe provision neon --yes or stripe projects add supabase/project.',
      ),
    ).toEqual(['neon', 'supabase/project']);
  });

  it('extracts llms.txt URLs relative to the origin', () => {
    expect(
      extractLlmsTxtUrls(
        '<link rel="describedby" href="/docs/llms.txt">',
        'https://shop.example.com',
      ),
    ).toContain('https://shop.example.com/docs/llms.txt');
  });

  it('extracts markdown MCP links', () => {
    expect(
      extractMarkdownMcpLinks(
        '- [Shop MCP](https://shop.example.com/api/mcp)\n- [Docs](https://shop.example.com/docs)',
      ),
    ).toEqual([{ name: 'Shop MCP', url: 'https://shop.example.com/api/mcp' }]);
  });

  it('shell-quotes command arguments', () => {
    expect(quoteCommandArg("https://shop.example.com/a'b")).toBe(
      "'https://shop.example.com/a'\\''b'",
    );
  });
});
