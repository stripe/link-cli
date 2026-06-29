import type {
  McpToolCallParams,
  McpToolCallResult,
  UcpCartCreateParams,
  UcpCartUpdateParams,
  UcpCatalogLookupParams,
  UcpCatalogSearchParams,
  UcpCheckoutCompleteParams,
  UcpCheckoutCreateParams,
  UcpCheckoutUpdateParams,
  UcpDiscoveryResult,
  UcpDiscoverySpec,
  UcpOperationResult,
  UcpOrderGetParams,
} from './ucp-types';

export type UcpTransport = 'auto' | 'rest' | 'mcp';

export interface UcpAuth {
  profileUrl?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}

export interface UcpResourceOptions {
  fetch?: typeof globalThis.fetch;
  auth?: UcpAuth;
  timeoutMs?: number;
  transport?: UcpTransport;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface NegotiatedEndpoint {
  endpoint: string;
  tools: Record<string, ToolDescriptor>;
}

interface RestRoute {
  method: string;
  path: string;
  bodyKey?: string;
}

const REST_ROUTES: Record<string, RestRoute> = {
  search_catalog: { method: 'POST', path: '/catalog/search', bodyKey: 'catalog' },
  lookup_catalog: { method: 'POST', path: '/catalog/lookup', bodyKey: 'catalog' },
  get_product: { method: 'POST', path: '/catalog/product' },
  create_cart: { method: 'POST', path: '/carts', bodyKey: 'cart' },
  get_cart: { method: 'GET', path: '/carts/{id}' },
  update_cart: { method: 'PUT', path: '/carts/{id}', bodyKey: 'cart' },
  cancel_cart: { method: 'POST', path: '/carts/{id}/cancel' },
  create_checkout: { method: 'POST', path: '/checkout-sessions', bodyKey: 'checkout' },
  get_checkout: { method: 'GET', path: '/checkout-sessions/{id}' },
  update_checkout: { method: 'PUT', path: '/checkout-sessions/{id}', bodyKey: 'checkout' },
  complete_checkout: {
    method: 'POST',
    path: '/checkout-sessions/{id}/complete',
  },
  cancel_checkout: { method: 'POST', path: '/checkout-sessions/{id}/cancel' },
  get_order: { method: 'GET', path: '/orders/{id}' },
};

let nextRequestId = 1;

export class UcpResource {
  private fetchImpl: typeof globalThis.fetch;
  private auth: UcpAuth;
  private timeoutMs: number;
  private transport: UcpTransport;
  private negotiatedCache: Map<string, NegotiatedEndpoint> = new Map();
  private discoveryCache: Map<string, UcpDiscoveryResult> = new Map();

  constructor(options: UcpResourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.auth = options.auth ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transport = options.transport ?? 'auto';
  }

  async discover(businessUrl: string): Promise<UcpDiscoveryResult> {
    const normalized = this.normalizeBusinessUrl(businessUrl);

    const cached = this.discoveryCache.get(normalized);
    if (cached) return cached;

    const wellKnownUrl = `${normalized}/.well-known/ucp`;

    const response = await this.httpGet(wellKnownUrl);
    if (!response.ok) {
      throw new UcpError(
        `Discovery failed for ${businessUrl}: HTTP ${response.status}`,
        'DISCOVERY_FAILED',
        { status: response.status, business: businessUrl },
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new UcpError(
        `Discovery response is not valid JSON: ${businessUrl}`,
        'DISCOVERY_INVALID_RESPONSE',
        { business: businessUrl },
      );
    }

    const spec = (body as Record<string, unknown>).ucp as
      | UcpDiscoverySpec
      | undefined;
    if (!spec) {
      throw new UcpError(
        `Discovery response missing "ucp" field: ${businessUrl}`,
        'DISCOVERY_INVALID_RESPONSE',
        { business: businessUrl, body },
      );
    }

    const { mcpEndpoint, restEndpoint } = this.extractEndpoints(spec);
    const capabilities = Object.keys(spec.capabilities ?? {});
    const paymentHandlers = Object.keys(spec.payment_handlers ?? {});

    const result: UcpDiscoveryResult = {
      business: normalized,
      ucp: spec,
      mcp_endpoint: mcpEndpoint,
      rest_endpoint: restEndpoint,
      capabilities,
      payment_handlers: paymentHandlers,
    };

    this.discoveryCache.set(normalized, result);
    return result;
  }

  async catalogSearch(
    businessUrl: string,
    params: UcpCatalogSearchParams,
  ): Promise<UcpOperationResult> {
    const { query, limit, cursor, ...rest } = params;
    const args: Record<string, unknown> = {
      catalog: {
        query,
        ...(limit !== undefined && { limit }),
        ...(cursor !== undefined && { cursor }),
      },
      ...rest,
    };
    return this.callOperation(businessUrl, 'search_catalog', args);
  }

  async catalogLookup(
    businessUrl: string,
    params: UcpCatalogLookupParams,
  ): Promise<UcpOperationResult> {
    const { ids, ...rest } = params;
    return this.callOperation(businessUrl, 'lookup_catalog', {
      catalog: { ids },
      ...rest,
    });
  }

  async cartCreate(
    businessUrl: string,
    params: UcpCartCreateParams,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'create_cart', { cart: params });
  }

  async cartGet(
    businessUrl: string,
    cartId: string,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'get_cart', { id: cartId });
  }

  async cartUpdate(
    businessUrl: string,
    cartId: string,
    params: UcpCartUpdateParams,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'update_cart', {
      id: cartId,
      cart: params,
    });
  }

  async checkoutCreate(
    businessUrl: string,
    params: UcpCheckoutCreateParams,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'create_checkout', {
      checkout: params,
    });
  }

  async checkoutGet(
    businessUrl: string,
    checkoutId: string,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'get_checkout', { id: checkoutId });
  }

  async checkoutUpdate(
    businessUrl: string,
    checkoutId: string,
    params: UcpCheckoutUpdateParams,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'update_checkout', {
      id: checkoutId,
      checkout: params,
    });
  }

  async checkoutComplete(
    businessUrl: string,
    checkoutId: string,
    params?: UcpCheckoutCompleteParams,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'complete_checkout', {
      id: checkoutId,
      ...(params ?? {}),
    });
  }

  async orderGet(
    businessUrl: string,
    orderId: string,
  ): Promise<UcpOperationResult> {
    return this.callOperation(businessUrl, 'get_order', { id: orderId });
  }

  // --- Internal: Transport Selection ---

  private async callOperation(
    businessUrl: string,
    operationId: string,
    args: Record<string, unknown>,
  ): Promise<UcpOperationResult> {
    const normalized = this.normalizeBusinessUrl(businessUrl);

    if (!this.auth.profileUrl) {
      throw new UcpError(
        'A --profile-url is required for UCP operations (catalog, cart, checkout). Use `ucp discover` without one to inspect capabilities first.',
        'AUTH_PROFILE_REQUIRED',
        { business: normalized },
      );
    }

    const discovery = await this.discover(normalized);
    const useRest = this.shouldUseRest(discovery, operationId);

    if (useRest) {
      return this.callRest(discovery.rest_endpoint!, operationId, args);
    }
    return this.callMcp(normalized, operationId, args);
  }

  private shouldUseRest(
    discovery: UcpDiscoveryResult,
    operationId: string,
  ): boolean {
    if (this.transport === 'mcp') return false;
    if (this.transport === 'rest') {
      if (!discovery.rest_endpoint) {
        throw new UcpError(
          'REST transport requested but merchant does not advertise a REST endpoint.',
          'NO_REST_ENDPOINT',
          { business: discovery.business },
        );
      }
      if (!REST_ROUTES[operationId]) {
        throw new UcpError(
          `No REST route mapping for operation "${operationId}".`,
          'NO_REST_ROUTE',
          { business: discovery.business, operation: operationId },
        );
      }
      return true;
    }
    // auto: prefer REST when available and route is known
    return !!discovery.rest_endpoint && !!REST_ROUTES[operationId];
  }

  // --- REST Transport ---

  private async callRest(
    restEndpoint: string,
    operationId: string,
    args: Record<string, unknown>,
  ): Promise<UcpOperationResult> {
    const route = REST_ROUTES[operationId]!;
    const id = args.id as string | undefined;

    let path = route.path;
    if (id && path.includes('{id}')) {
      path = path.replace('{id}', encodeURIComponent(id));
    }

    const url = `${restEndpoint.replace(/\/+$/, '')}${path}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Request-Id': crypto.randomUUID(),
      ...this.authHeaders(),
      ...(this.auth.profileUrl
        ? { 'UCP-Agent': `profile="${this.auth.profileUrl}"` }
        : {}),
    };

    const hasBody = route.method !== 'GET';
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = crypto.randomUUID();
    }

    let body: string | undefined;
    if (hasBody) {
      const { id: _id, meta: _meta, ...payload } = args;
      // If route has a bodyKey, unwrap that key as the REST body
      const restBody = route.bodyKey
        ? (payload[route.bodyKey] as Record<string, unknown>) ?? payload
        : payload;
      body = JSON.stringify(restBody);
    }

    const response = await this.fetchImpl(url, {
      method: route.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const responseText = await response.text();
    if (!responseText) {
      if (!response.ok) {
        throw new UcpError(
          `REST ${route.method} ${path} failed: HTTP ${response.status}`,
          'REST_REQUEST_FAILED',
          { url, status: response.status, operation: operationId },
        );
      }
      return {} as UcpOperationResult;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new UcpError(
        `REST response is not valid JSON from ${url}`,
        'REST_INVALID_RESPONSE',
        { url, status: response.status, operation: operationId },
      );
    }

    if (!response.ok) {
      const errBody = parsed as Record<string, unknown>;
      const messages = errBody.messages as
        | Array<{ code?: string; content?: string }>
        | undefined;
      const msg =
        messages?.[0]?.content ?? `HTTP ${response.status}`;
      throw new UcpError(
        `REST ${route.method} ${path} failed: ${msg}`,
        'REST_REQUEST_FAILED',
        { url, status: response.status, operation: operationId, body: errBody },
      );
    }

    return parsed as UcpOperationResult;
  }

  // --- MCP Transport ---

  private async callMcp(
    businessUrl: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<UcpOperationResult> {
    const negotiated = await this.negotiate(businessUrl);

    if (!negotiated.tools[toolName]) {
      throw new UcpError(
        `Tool "${toolName}" not available on ${businessUrl}. Available: ${Object.keys(negotiated.tools).join(', ')}`,
        'TOOL_NOT_FOUND',
        {
          business: businessUrl,
          tool: toolName,
          available: Object.keys(negotiated.tools),
        },
      );
    }

    const toolArgs: Record<string, unknown> = {
      ...args,
      meta: {
        ...((args.meta as Record<string, unknown>) ?? {}),
        ...(this.auth.profileUrl
          ? { 'ucp-agent': { profile: this.auth.profileUrl } }
          : {}),
        'idempotency-key': crypto.randomUUID(),
      },
    };

    const params: McpToolCallParams = {
      name: toolName,
      arguments: toolArgs,
    };

    const result = await this.mcpRpc<McpToolCallResult>(
      negotiated.endpoint,
      'tools/call',
      params,
    );

    return this.unwrapMcpResult(result, toolName, businessUrl);
  }

  private async negotiate(businessUrl: string): Promise<NegotiatedEndpoint> {
    const cached = this.negotiatedCache.get(businessUrl);
    if (cached) return cached;

    const discovery = await this.discover(businessUrl);
    if (!discovery.mcp_endpoint) {
      throw new UcpError(
        `No MCP endpoint found for ${businessUrl}. The merchant may not support MCP transport.`,
        'NO_MCP_ENDPOINT',
        { business: businessUrl },
      );
    }

    const toolsListResult = await this.mcpRpc<{ tools: ToolDescriptor[] }>(
      discovery.mcp_endpoint,
      'tools/list',
      {
        arguments: {
          meta: {
            ...(this.auth.profileUrl
              ? { 'ucp-agent': { profile: this.auth.profileUrl } }
              : {}),
          },
        },
      },
    );

    const tools: Record<string, ToolDescriptor> = {};
    for (const tool of toolsListResult.tools ?? []) {
      tools[tool.name] = tool;
    }

    const negotiated: NegotiatedEndpoint = {
      endpoint: discovery.mcp_endpoint,
      tools,
    };
    this.negotiatedCache.set(businessUrl, negotiated);
    return negotiated;
  }

  private unwrapMcpResult(
    result: McpToolCallResult,
    toolName: string,
    businessUrl: string,
  ): UcpOperationResult {
    const r = result as unknown as Record<string, unknown>;
    if (
      typeof r.structuredContent === 'object' &&
      r.structuredContent !== null
    ) {
      return r.structuredContent as UcpOperationResult;
    }

    const textContent = result.content?.find((c) => c.type === 'text');
    if (textContent?.text) {
      try {
        const parsed = JSON.parse(textContent.text) as UcpOperationResult;
        return parsed;
      } catch {
        if (result.isError) {
          throw new UcpError(
            `UCP operation ${toolName} failed: ${textContent.text}`,
            'OPERATION_FAILED',
            { business: businessUrl, tool: toolName, content: result.content },
          );
        }
        return { raw_text: textContent.text } as UcpOperationResult;
      }
    }

    if (result.isError) {
      throw new UcpError(
        `UCP operation ${toolName} failed with no content`,
        'OPERATION_FAILED',
        { business: businessUrl, tool: toolName, content: result.content },
      );
    }

    return { content: result.content } as UcpOperationResult;
  }

  private async mcpRpc<T>(
    endpoint: string,
    method: string,
    params?: unknown,
  ): Promise<T> {
    const id = nextRequestId++;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    });

    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.authHeaders(),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const responseText = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new UcpError(
        `MCP response is not valid JSON from ${endpoint}`,
        'MCP_INVALID_RESPONSE',
        { endpoint, method, status: response.status },
      );
    }

    const envelope = parsed as Record<string, unknown>;
    if (envelope.jsonrpc !== '2.0') {
      throw new UcpError(
        `Invalid JSON-RPC response from ${endpoint}`,
        'MCP_INVALID_RESPONSE',
        { endpoint, method, body: envelope },
      );
    }

    if (envelope.error) {
      const err = envelope.error as {
        code: number;
        message: string;
        data?: unknown;
      };
      throw new UcpError(
        `MCP RPC error from ${endpoint}: (${err.code}) ${err.message}`,
        'MCP_RPC_ERROR',
        { endpoint, method, rpcCode: err.code, rpcData: err.data },
      );
    }

    return envelope.result as T;
  }

  // --- Auth ---

  private authHeaders(): Record<string, string> {
    if (this.auth.accessToken) {
      return { Authorization: `Bearer ${this.auth.accessToken}` };
    }
    if (this.auth.clientId && this.auth.clientSecret) {
      const encoded = btoa(`${this.auth.clientId}:${this.auth.clientSecret}`);
      return { Authorization: `Basic ${encoded}` };
    }
    return {};
  }

  // --- Helpers ---

  private async httpGet(url: string): Promise<Response> {
    return this.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private normalizeBusinessUrl(url: string): string {
    let normalized = url.trim();
    if (
      !normalized.startsWith('http://') &&
      !normalized.startsWith('https://')
    ) {
      normalized = `https://${normalized}`;
    }
    return normalized.replace(/\/+$/, '');
  }

  private extractEndpoints(spec: UcpDiscoverySpec): {
    mcpEndpoint: string | null;
    restEndpoint: string | null;
  } {
    const shoppingService = spec.services?.['dev.ucp.shopping'];
    if (!shoppingService) return { mcpEndpoint: null, restEndpoint: null };

    const mcpBinding = shoppingService.find((s) => s.transport === 'mcp');
    const restBinding = shoppingService.find((s) => s.transport === 'rest');

    return {
      mcpEndpoint: mcpBinding?.endpoint ?? null,
      restEndpoint: restBinding?.endpoint ?? null,
    };
  }
}

export class UcpError extends Error {
  code: string;
  context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'UcpError';
    this.code = code;
    this.context = context;
  }
}
