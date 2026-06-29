import { describe, expect, it, vi } from 'vitest';
import { UcpResource, UcpError } from '../resources/ucp';

const DISCOVERY_RESPONSE = {
  ucp: {
    version: '2026-04-08',
    services: {
      'dev.ucp.shopping': [
        { version: '1.0', spec: 'ucp', transport: 'rest', endpoint: 'https://merchant.example.com/ucp/rest' },
        { version: '1.0', spec: 'ucp', transport: 'mcp', endpoint: 'https://merchant.example.com/ucp/mcp' },
      ],
    },
    capabilities: {
      'dev.ucp.catalog': [{ version: '1.0', spec: 'ucp' }],
      'dev.ucp.cart': [{ version: '1.0', spec: 'ucp' }],
    },
    payment_handlers: {},
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createResource(
  fetchMock: ReturnType<typeof vi.fn>,
  opts: { profileUrl?: string; clientId?: string; clientSecret?: string; accessToken?: string; transport?: 'auto' | 'rest' | 'mcp' } = {},
) {
  return new UcpResource({
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    auth: {
      profileUrl: opts.profileUrl,
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      accessToken: opts.accessToken,
    },
    transport: opts.transport,
  });
}

describe('UcpResource', () => {
  describe('discover', () => {
    it('fetches .well-known/ucp and returns parsed result', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DISCOVERY_RESPONSE));
      const resource = createResource(fetchMock);

      const result = await resource.discover('https://merchant.example.com');

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe('https://merchant.example.com/.well-known/ucp');
      expect(result.business).toBe('https://merchant.example.com');
      expect(result.rest_endpoint).toBe('https://merchant.example.com/ucp/rest');
      expect(result.mcp_endpoint).toBe('https://merchant.example.com/ucp/mcp');
      expect(result.capabilities).toContain('dev.ucp.catalog');
    });

    it('throws DISCOVERY_FAILED on non-200', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
      const resource = createResource(fetchMock);

      await expect(resource.discover('https://merchant.example.com')).rejects.toThrow(UcpError);
      await expect(resource.discover('https://merchant.example.com')).rejects.toMatchObject({ code: 'DISCOVERY_FAILED' });
    });

    it('caches discovery results', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DISCOVERY_RESPONSE));
      const resource = createResource(fetchMock);

      await resource.discover('https://merchant.example.com');
      await resource.discover('https://merchant.example.com');

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('normalizes URLs without protocol', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DISCOVERY_RESPONSE));
      const resource = createResource(fetchMock);

      await resource.discover('merchant.example.com');

      expect(fetchMock.mock.calls[0][0]).toBe('https://merchant.example.com/.well-known/ucp');
    });
  });

  describe('catalogSearch (REST)', () => {
    it('sends POST to /catalog/search with query', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ products: [] }));

      const resource = createResource(fetchMock, { profileUrl: 'https://agent.example/profile.json', transport: 'rest' });

      await resource.catalogSearch('https://merchant.example.com', { query: 'boots' });

      const [url, opts] = fetchMock.mock.calls[1];
      expect(url).toBe('https://merchant.example.com/ucp/rest/catalog/search');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ query: 'boots' });
    });

    it('throws AUTH_PROFILE_REQUIRED when no profileUrl', async () => {
      const fetchMock = vi.fn();
      const resource = createResource(fetchMock);

      await expect(
        resource.catalogSearch('https://merchant.example.com', { query: 'boots' }),
      ).rejects.toMatchObject({ code: 'AUTH_PROFILE_REQUIRED' });
    });
  });

  describe('auth headers', () => {
    it('sends Bearer token when accessToken is set', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ products: [] }));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        accessToken: 'tok_123',
        transport: 'rest',
      });

      await resource.catalogSearch('https://merchant.example.com', { query: 'boots' });

      const headers = fetchMock.mock.calls[1][1].headers;
      expect(headers.Authorization).toBe('Bearer tok_123');
    });

    it('sends Basic auth when clientId and clientSecret are set', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ products: [] }));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        clientId: 'my_client',
        clientSecret: 'my_secret',
        transport: 'rest',
      });

      await resource.catalogSearch('https://merchant.example.com', { query: 'boots' });

      const headers = fetchMock.mock.calls[1][1].headers;
      const expected = `Basic ${btoa('my_client:my_secret')}`;
      expect(headers.Authorization).toBe(expected);
    });

    it('Bearer token takes precedence over client credentials', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ products: [] }));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        clientId: 'my_client',
        clientSecret: 'my_secret',
        accessToken: 'tok_123',
        transport: 'rest',
      });

      await resource.catalogSearch('https://merchant.example.com', { query: 'boots' });

      const headers = fetchMock.mock.calls[1][1].headers;
      expect(headers.Authorization).toBe('Bearer tok_123');
    });

    it('sends no Authorization header when no credentials are set', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ products: [] }));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        transport: 'rest',
      });

      await resource.catalogSearch('https://merchant.example.com', { query: 'boots' });

      const headers = fetchMock.mock.calls[1][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('UCP-Agent header', () => {
    it('includes profile URL in UCP-Agent header', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({}));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        transport: 'rest',
      });

      await resource.catalogSearch('https://merchant.example.com', { query: 'test' });

      const headers = fetchMock.mock.calls[1][1].headers;
      expect(headers['UCP-Agent']).toBe('profile="https://agent.example/profile.json"');
    });
  });

  describe('cartCreate (REST)', () => {
    it('sends POST to /carts with line items', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ id: 'cart_1', line_items: [] }));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        transport: 'rest',
      });

      const lineItems = [{ item: { id: 'variant_1' }, quantity: 2 }];
      await resource.cartCreate('https://merchant.example.com', { line_items: lineItems });

      const [url, opts] = fetchMock.mock.calls[1];
      expect(url).toBe('https://merchant.example.com/ucp/rest/carts');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body)).toEqual({ line_items: lineItems });
    });
  });

  describe('checkoutComplete (REST)', () => {
    it('sends POST to /checkout-sessions/{id}/complete', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse({ id: 'cs_1', status: 'completed' }));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        transport: 'rest',
      });

      await resource.checkoutComplete('https://merchant.example.com', 'cs_1', { payment_method: 'pm_1' });

      const [url, opts] = fetchMock.mock.calls[1];
      expect(url).toBe('https://merchant.example.com/ucp/rest/checkout-sessions/cs_1/complete');
      expect(opts.method).toBe('POST');
    });
  });

  describe('MCP transport', () => {
    it('calls tools/list then tools/call via JSON-RPC', async () => {
      const toolsListResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [{ name: 'search_catalog', description: 'Search catalog' }],
        },
      };
      const toolCallResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: '{"products":[]}' }],
        },
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(toolsListResponse))
        .mockResolvedValueOnce(jsonResponse(toolCallResponse));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        transport: 'mcp',
      });

      const result = await resource.catalogSearch('https://merchant.example.com', { query: 'boots' });

      expect(result).toEqual({ products: [] });

      // tools/list call
      const listBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(listBody.method).toBe('tools/list');

      // tools/call
      const callBody = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(callBody.method).toBe('tools/call');
      expect(callBody.params.name).toBe('search_catalog');
    });

    it('sends auth headers on MCP requests', async () => {
      const toolsListResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [{ name: 'search_catalog' }] },
      };
      const toolCallResponse = {
        jsonrpc: '2.0',
        id: 2,
        result: { content: [{ type: 'text', text: '{}' }] },
      };

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(DISCOVERY_RESPONSE))
        .mockResolvedValueOnce(jsonResponse(toolsListResponse))
        .mockResolvedValueOnce(jsonResponse(toolCallResponse));

      const resource = createResource(fetchMock, {
        profileUrl: 'https://agent.example/profile.json',
        accessToken: 'tok_abc',
        transport: 'mcp',
      });

      await resource.catalogSearch('https://merchant.example.com', { query: 'test' });

      // Both MCP calls should have Bearer token
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok_abc');
      expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer tok_abc');
    });
  });
});
