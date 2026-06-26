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

export interface UcpResourceOptions {
  fetch?: typeof globalThis.fetch;
  profileUrl: string;
  timeoutMs?: number;
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

let nextRequestId = 1;

export class UcpResource {
  private fetchImpl: typeof globalThis.fetch;
  private profileUrl: string;
  private timeoutMs: number;
  private negotiatedCache: Map<string, NegotiatedEndpoint> = new Map();

  constructor(options: UcpResourceOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.profileUrl = options.profileUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async discover(businessUrl: string): Promise<UcpDiscoveryResult> {
    const normalized = this.normalizeBusinessUrl(businessUrl);
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

    const mcpEndpoint = this.extractMcpEndpoint(spec);
    const capabilities = Object.keys(spec.capabilities ?? {});
    const paymentHandlers = Object.keys(spec.payment_handlers ?? {});

    return {
      business: normalized,
      ucp: spec,
      mcp_endpoint: mcpEndpoint,
      capabilities,
      payment_handlers: paymentHandlers,
    };
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
    return this.callTool(businessUrl, 'search_catalog', args);
  }

  async catalogLookup(
    businessUrl: string,
    params: UcpCatalogLookupParams,
  ): Promise<UcpOperationResult> {
    const { ids, ...rest } = params;
    return this.callTool(businessUrl, 'lookup_catalog', {
      catalog: { ids },
      ...rest,
    });
  }

  async cartCreate(
    businessUrl: string,
    params: UcpCartCreateParams,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'create_cart', { cart: params });
  }

  async cartGet(
    businessUrl: string,
    cartId: string,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'get_cart', { id: cartId });
  }

  async cartUpdate(
    businessUrl: string,
    cartId: string,
    params: UcpCartUpdateParams,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'update_cart', {
      id: cartId,
      cart: params,
    });
  }

  async checkoutCreate(
    businessUrl: string,
    params: UcpCheckoutCreateParams,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'create_checkout', { checkout: params });
  }

  async checkoutGet(
    businessUrl: string,
    checkoutId: string,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'get_checkout', { id: checkoutId });
  }

  async checkoutUpdate(
    businessUrl: string,
    checkoutId: string,
    params: UcpCheckoutUpdateParams,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'update_checkout', {
      id: checkoutId,
      checkout: params,
    });
  }

  async checkoutComplete(
    businessUrl: string,
    checkoutId: string,
    params?: UcpCheckoutCompleteParams,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'complete_checkout', {
      id: checkoutId,
      ...(params ?? {}),
    });
  }

  async orderGet(
    businessUrl: string,
    orderId: string,
  ): Promise<UcpOperationResult> {
    return this.callTool(businessUrl, 'get_order', { id: orderId });
  }

  // --- Internal ---

  private async negotiate(businessUrl: string): Promise<NegotiatedEndpoint> {
    const cached = this.negotiatedCache.get(businessUrl);
    if (cached) return cached;

    if (!this.profileUrl) {
      throw new UcpError(
        'A --profile-url is required for UCP operations (catalog, cart, checkout). Use `ucp discover` without one to inspect capabilities first.',
        'PROFILE_REQUIRED',
        { business: businessUrl },
      );
    }

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
            'ucp-agent': { profile: this.profileUrl },
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

  private async callTool(
    businessUrl: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<UcpOperationResult> {
    const normalized = this.normalizeBusinessUrl(businessUrl);
    const negotiated = await this.negotiate(normalized);

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
        'ucp-agent': { profile: this.profileUrl },
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

    return this.unwrapResult(result, toolName, businessUrl);
  }

  private unwrapResult(
    result: McpToolCallResult,
    toolName: string,
    businessUrl: string,
  ): UcpOperationResult {
    // Prefer structuredContent (newer MCP), fall back to text content
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
        // UCP uses isError for escalation responses too — return them as data
        // so agents can inspect status/continue_url
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

  private extractMcpEndpoint(spec: UcpDiscoverySpec): string | null {
    const shoppingService = spec.services?.['dev.ucp.shopping'];
    if (!shoppingService) return null;
    const mcpBinding = shoppingService.find((s) => s.transport === 'mcp');
    return mcpBinding?.endpoint ?? null;
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
