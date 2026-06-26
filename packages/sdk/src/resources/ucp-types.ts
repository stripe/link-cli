// UCP (Universal Commerce Protocol) types
// Protocol spec: https://ucp.dev/2026-04-08/specification/overview/

// --- Discovery (.well-known/ucp) ---

export interface UcpServiceBinding {
  version: string;
  spec: string;
  transport: 'mcp' | 'embedded' | string;
  endpoint?: string;
  schema?: string;
}

export interface UcpCapability {
  version: string;
  spec: string;
  schema?: string;
  config?: Record<string, unknown>;
  extends?: string[];
  requires?: { protocol?: { min?: string } };
}

export interface UcpPaymentHandler {
  version: string;
  spec: string;
  schema?: string;
  id?: string;
  config?: Record<string, unknown>;
}

export interface UcpDiscoverySpec {
  version: string;
  supported_versions?: Record<string, string>;
  services: Record<string, UcpServiceBinding[]>;
  capabilities: Record<string, UcpCapability[]>;
  payment_handlers?: Record<string, UcpPaymentHandler[]>;
}

export interface UcpDiscoveryResult {
  business: string;
  ucp: UcpDiscoverySpec;
  mcp_endpoint: string | null;
  capabilities: string[];
  payment_handlers: string[];
}

// --- MCP JSON-RPC transport ---

export interface McpToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: unknown;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

// --- Catalog ---

export interface UcpCatalogSearchParams {
  query: string;
  limit?: number;
  cursor?: string;
  [key: string]: unknown;
}

export interface UcpCatalogLookupParams {
  ids: string[];
  [key: string]: unknown;
}

// --- Cart ---

export interface UcpLineItem {
  item: { id: string; [key: string]: unknown };
  quantity: number;
  id?: string;
  [key: string]: unknown;
}

export interface UcpCartCreateParams {
  line_items: UcpLineItem[];
  [key: string]: unknown;
}

export interface UcpCartUpdateParams {
  line_items?: UcpLineItem[];
  [key: string]: unknown;
}

// --- Checkout ---

export interface UcpCheckoutCreateParams {
  cart_id?: string;
  line_items?: UcpLineItem[];
  [key: string]: unknown;
}

export interface UcpCheckoutUpdateParams {
  [key: string]: unknown;
}

export interface UcpCheckoutCompleteParams {
  [key: string]: unknown;
}

// --- Generic operation result (pass-through) ---
// UCP responses are passed through raw; these are the common envelope fields.

export type UcpOperationResult = Record<string, unknown>;
