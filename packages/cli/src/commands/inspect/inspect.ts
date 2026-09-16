import { sanitizeDeep } from '../../utils/sanitize-text';
import { decodeStripeChallenge } from '../mpp/decode';

const DEFAULT_TIMEOUT_MS = 5000;
const LLMS_TXT_PATHS = ['/llms.txt', '/llms-full.txt'];
const MCP_WELL_KNOWN_PATHS = [
  '/.well-known/mcp.json',
  '/.well-known/mcp',
  '/.well-known/mcp-server-card',
];

export interface InspectTool {
  command: string;
  description: string;
  url?: string;
  /** MPP payment rail, when known. Omitted for non-MPP tools. */
  method?: string;
}

export interface BrowserCheckoutTool {
  merchant_advice?: string;
  general_advice?: string;
}

export interface AvailableTools {
  machine_payments?: InspectTool[];
  mcp?: InspectTool[];
  /** Reserved. Inspect does not populate this yet. */
  provisioning?: InspectTool[];
  browser_checkout?: BrowserCheckoutTool;
}

export interface InspectResult {
  display_name?: string;
  description?: string;
  url: string;
  llms_txt?: string[];
  available_tools?: AvailableTools;
}

export interface EndpointProbe {
  url: string;
  found: boolean;
  status?: number;
  error?: string;
}

export interface MppOffer {
  method: string;
  intent?: string;
  amount?: string;
  currency?: string;
  description?: string;
}

export interface MppOperation {
  path: string;
  method: string;
  operation_id?: string;
  summary?: string;
  description?: string;
  request_body_schema?: unknown;
  offers: MppOffer[];
}

export interface MppOpenapiProbe extends EndpointProbe {
  api_title?: string;
  api_description?: string;
  api_guidance?: string;
  offered_methods?: string[];
  offers_stripe?: boolean;
  operations?: MppOperation[];
}

export interface UcpServiceEntry {
  service: string;
  version?: string;
  transport?: string;
  endpoint?: string;
}

export interface UcpCapabilityEntry {
  capability: string;
  version?: string;
  endpoint?: string;
}

export interface UcpPaymentHandlerEntry {
  handler: string;
  id?: string;
  version?: string;
}

export interface UcpProbe extends EndpointProbe {
  merchant?: string;
  description?: string;
  version?: string;
  services?: UcpServiceEntry[];
  capabilities?: UcpCapabilityEntry[];
  payment_handlers?: UcpPaymentHandlerEntry[];
}

export interface LiveChallengeProbe {
  attempted: boolean;
  url?: string;
  method?: string;
  status?: number;
  found: boolean;
  network_id?: string;
  description?: string;
  error?: string;
}

interface LinkPayTokenProbe {
  url: string;
  found: boolean;
  indicators: string[];
  status?: number;
  error?: string;
}

interface PageProbe {
  url: string;
  status?: number;
  isHtml: boolean;
  html?: string;
  error?: string;
}

interface LlmsTxtFile {
  url: string;
  body: string;
}

interface DiscoveredMcpServer {
  url: string;
  name?: string;
  description?: string;
}

type FetchLike = typeof fetch;

export function quoteCommandArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function parseLlmsTxtMeta(body: string): {
  title?: string;
  summary?: string;
} {
  const text = body.replace(/^\uFEFF/, '');
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const summary = text.match(/^>\s+(.+)$/m)?.[1]?.trim();
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
  };
}

export function parseMcpManifest(
  spec: unknown,
): { url: string; name?: string; description?: string }[] {
  if (!spec || typeof spec !== 'object') return [];
  const obj = spec as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const description =
    typeof obj.description === 'string' ? obj.description : undefined;
  const found = new Map<
    string,
    { url: string; name?: string; description?: string }
  >();

  const add = (
    url: unknown,
    extra?: { name?: string; description?: string },
  ) => {
    if (typeof url !== 'string' || !url.trim()) return;
    const trimmed = url.trim();
    if (!found.has(trimmed)) {
      found.set(trimmed, {
        url: trimmed,
        name: extra?.name ?? name,
        description: extra?.description ?? description,
      });
    }
  };

  if (Array.isArray(obj.remotes)) {
    for (const remote of obj.remotes) {
      if (remote && typeof remote === 'object') {
        add((remote as Record<string, unknown>).url);
      }
    }
  }

  add(obj.url);
  add(obj.endpoint);
  add(obj.mcp_url);

  if (obj.endpoints && typeof obj.endpoints === 'object') {
    const endpoints = obj.endpoints as Record<string, unknown>;
    add(endpoints.streamable_http);
    add(endpoints.sse);
    add(endpoints.http);
  }

  if (obj.server && typeof obj.server === 'object') {
    add((obj.server as Record<string, unknown>).url);
  }

  return Array.from(found.values());
}

export function extractProvisionSlugs(text: string): string[] {
  const slugs = new Set<string>();
  const patterns = [
    /\bstripe\s+provision\s+([A-Za-z0-9][A-Za-z0-9._/-]*)/g,
    /\bstripe\s+projects\s+add\s+([A-Za-z0-9][A-Za-z0-9._/-]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const slug = match[1]?.replace(/[.,;:]+$/, '');
      if (slug) slugs.add(slug);
    }
  }
  return Array.from(slugs);
}

export function extractLlmsTxtUrls(text: string, base: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /(?:href|content)\s*=\s*["']([^"']*llms(?:-full)?\.txt[^"']*)["']/gi,
    /\[[^\]]*\]\(([^)]*llms(?:-full)?\.txt[^)]*)\)/gi,
    /https?:\/\/[^\s)"']+llms(?:-full)?\.txt/gi,
    /(?:^|\s)(\/?[^\s)"']*llms(?:-full)?\.txt)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = (match[1] ?? match[0])?.trim();
      if (!raw) continue;
      try {
        urls.add(new URL(raw, base).toString());
      } catch {
        // ignore unparseable refs
      }
    }
  }
  return Array.from(urls);
}

export function extractMarkdownMcpLinks(
  text: string,
): { name: string; url: string }[] {
  const results: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const name = match[1]?.trim();
    const url = match[2]?.trim();
    if (!name || !url) continue;
    if (!/mcp/i.test(name) && !/mcp/i.test(url)) continue;
    try {
      const absolute = new URL(url).toString();
      if (seen.has(absolute)) continue;
      seen.add(absolute);
      results.push({ name, url: absolute });
    } catch {
      // ignore relative/non-URL refs
    }
  }
  return results;
}

export function compactInspectResult(result: InspectResult): InspectResult {
  return compactRecord(
    result as unknown as Record<string, unknown>,
  ) as unknown as InspectResult;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const compacted = compactValue(raw);
    if (compacted === undefined) continue;
    result[key] = compacted;
  }
  return result;
}

function compactValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => compactValue(item))
      .filter((item) => item !== undefined);
    return items.length === 0 ? undefined : items;
  }
  if (typeof value === 'object') {
    const nested = compactRecord(value as Record<string, unknown>);
    return Object.keys(nested).length === 0 ? undefined : nested;
  }
  return value;
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function probeJsonEndpoint(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<EndpointProbe> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    if (!response.ok) {
      return { url, found: false, status: response.status };
    }
    const text = await response.text();
    try {
      JSON.parse(text);
    } catch {
      return {
        url,
        found: false,
        status: response.status,
        error: 'response was not valid JSON',
      };
    }
    return { url, found: true, status: response.status };
  } catch (err) {
    return { url, found: false, error: errorMessage(err) };
  }
}

// UCP merchant profiles (https://ucp.dev) nest everything under a top-level
// `ucp` key: `merchant`/`description`/`version`, `services` (transport
// endpoints, e.g. the MCP/REST entry points), `capabilities` (individual
// operations like catalog.search or checkout), and `payment_handlers` (e.g.
// "com.stripe.payments"). Each is a map of name -> array of versioned
// entries, so we flatten them into name-tagged lists for easy reading.
function getUcpNode(spec: unknown): Record<string, unknown> | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const ucp = (spec as Record<string, unknown>).ucp;
  return ucp && typeof ucp === 'object' && !Array.isArray(ucp)
    ? (ucp as Record<string, unknown>)
    : undefined;
}

function extractUcpText(
  ucpNode: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = ucpNode?.[field];
  return typeof value === 'string' ? value : undefined;
}

function extractUcpServices(
  ucpNode: Record<string, unknown> | undefined,
): UcpServiceEntry[] {
  const services = ucpNode?.services;
  if (!services || typeof services !== 'object') return [];
  const result: UcpServiceEntry[] = [];
  for (const [service, entries] of Object.entries(
    services as Record<string, unknown>,
  )) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      result.push({
        service,
        version: typeof e.version === 'string' ? e.version : undefined,
        transport: typeof e.transport === 'string' ? e.transport : undefined,
        endpoint: typeof e.endpoint === 'string' ? e.endpoint : undefined,
      });
    }
  }
  return result;
}

function extractUcpCapabilities(
  ucpNode: Record<string, unknown> | undefined,
): UcpCapabilityEntry[] {
  const capabilities = ucpNode?.capabilities;
  if (!capabilities || typeof capabilities !== 'object') return [];
  const result: UcpCapabilityEntry[] = [];
  for (const [capability, entries] of Object.entries(
    capabilities as Record<string, unknown>,
  )) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      result.push({
        capability,
        version: typeof e.version === 'string' ? e.version : undefined,
        endpoint: typeof e.endpoint === 'string' ? e.endpoint : undefined,
      });
    }
  }
  return result;
}

function extractUcpPaymentHandlers(
  ucpNode: Record<string, unknown> | undefined,
): UcpPaymentHandlerEntry[] {
  const handlers = ucpNode?.payment_handlers;
  if (!handlers || typeof handlers !== 'object') return [];
  const result: UcpPaymentHandlerEntry[] = [];
  for (const [handler, entries] of Object.entries(
    handlers as Record<string, unknown>,
  )) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      result.push({
        handler,
        id: typeof e.id === 'string' ? e.id : undefined,
        version: typeof e.version === 'string' ? e.version : undefined,
      });
    }
  }
  return result;
}

async function probeUcpEndpoint(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<UcpProbe> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    if (!response.ok) {
      return { url, found: false, status: response.status };
    }
    const text = await response.text();
    let spec: unknown;
    try {
      spec = JSON.parse(text);
    } catch {
      return {
        url,
        found: false,
        status: response.status,
        error: 'response was not valid JSON',
      };
    }
    const ucpNode = getUcpNode(spec);
    return {
      url,
      found: true,
      status: response.status,
      merchant: extractUcpText(ucpNode, 'merchant'),
      description: extractUcpText(ucpNode, 'description'),
      version: extractUcpText(ucpNode, 'version'),
      services: extractUcpServices(ucpNode),
      capabilities: extractUcpCapabilities(ucpNode),
      payment_handlers: extractUcpPaymentHandlers(ucpNode),
    };
  } catch (err) {
    return { url, found: false, error: errorMessage(err) };
  }
}

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

function extractOffers(paymentInfo: unknown): MppOffer[] {
  if (!paymentInfo || typeof paymentInfo !== 'object') return [];
  const offers = (paymentInfo as Record<string, unknown>).offers;
  if (!Array.isArray(offers)) return [];

  const result: MppOffer[] = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object') continue;
    const o = offer as Record<string, unknown>;
    if (typeof o.method !== 'string') continue;
    result.push({
      method: o.method,
      intent: typeof o.intent === 'string' ? o.intent : undefined,
      amount: typeof o.amount === 'string' ? o.amount : undefined,
      currency: typeof o.currency === 'string' ? o.currency : undefined,
      description:
        typeof o.description === 'string' ? o.description : undefined,
    });
  }
  return result;
}

function extractRequestBodySchema(operation: Record<string, unknown>): unknown {
  const requestBody = operation.requestBody;
  if (!requestBody || typeof requestBody !== 'object') return undefined;
  const content = (requestBody as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return undefined;
  const json = (content as Record<string, unknown>)['application/json'];
  if (!json || typeof json !== 'object') return undefined;
  return (json as Record<string, unknown>).schema;
}

// Per https://mpp.dev/advanced/discovery, operations requiring payment carry
// `x-payment-info.offers[]`; each offer's `method` (e.g. "tempo", "stripe",
// "evm") names a payment rail. Link's shared_payment_token flow only works
// when "stripe" is among them -- most MPP integrations only offer crypto
// rails like "tempo". Some specs (e.g. climate.stripe.dev) instead declare a
// coarser `x-payment-info.protocols` list with no per-method breakdown; those
// operations are still extracted (with an empty `offers`) so a live 402
// probe can confirm stripe support (see probeLiveChallenge).
function extractOperations(spec: unknown): MppOperation[] {
  if (!spec || typeof spec !== 'object') return [];
  const paths = (spec as Record<string, unknown>).paths;
  if (!paths || typeof paths !== 'object') return [];

  const operations: MppOperation[] = [];
  for (const [path, pathItem] of Object.entries(
    paths as Record<string, unknown>,
  )) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== 'object') continue;
      const op = operation as Record<string, unknown>;
      const paymentInfo = op['x-payment-info'];
      if (!paymentInfo || typeof paymentInfo !== 'object') continue;

      operations.push({
        path,
        method: method.toUpperCase(),
        operation_id:
          typeof op.operationId === 'string' ? op.operationId : undefined,
        summary: typeof op.summary === 'string' ? op.summary : undefined,
        description:
          typeof op.description === 'string' ? op.description : undefined,
        request_body_schema: extractRequestBodySchema(op),
        offers: extractOffers(paymentInfo),
      });
    }
  }
  return operations;
}

function extractApiText(spec: unknown, field: string): string | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const info = (spec as Record<string, unknown>).info;
  if (!info || typeof info !== 'object') return undefined;
  const value = (info as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

async function probeMppOpenapiEndpoint(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<MppOpenapiProbe> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    if (!response.ok) {
      return { url, found: false, status: response.status };
    }
    const text = await response.text();
    let spec: unknown;
    try {
      spec = JSON.parse(text);
    } catch {
      return {
        url,
        found: false,
        status: response.status,
        error: 'response was not valid JSON',
      };
    }
    const operations = extractOperations(spec);
    const methods = new Set<string>();
    for (const operation of operations) {
      for (const offer of operation.offers) {
        methods.add(offer.method);
      }
    }
    const offeredMethods = Array.from(methods);
    return {
      url,
      found: true,
      status: response.status,
      api_title: extractApiText(spec, 'title'),
      api_description: extractApiText(spec, 'description'),
      api_guidance: extractApiText(spec, 'guidance'),
      offered_methods: offeredMethods,
      offers_stripe: offeredMethods.includes('stripe'),
      operations,
    };
  } catch (err) {
    return { url, found: false, error: errorMessage(err) };
  }
}

async function probeMppOpenapi(
  fetchImpl: FetchLike,
  origin: string,
  timeoutMs: number,
): Promise<MppOpenapiProbe[]> {
  const paths = ['/api/openapi.json', '/openapi.json'];
  const results: MppOpenapiProbe[] = [];
  for (const path of paths) {
    const result = await probeMppOpenapiEndpoint(
      fetchImpl,
      `${origin}${path}`,
      timeoutMs,
    );
    results.push(result);
    if (result.found) break;
  }
  return results;
}

const LINK_PAY_TOKEN_INDICATORS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /AiAgentPaymentSteering/i,
    label: 'Page HTML includes the "AiAgentPaymentSteering" component',
  },
  {
    pattern: /I am an AI agent/i,
    label: 'Page HTML includes "I am an AI agent" checkbox text',
  },
  {
    pattern: /link_pay_token/i,
    label: 'Page HTML references "link_pay_token"',
  },
];

async function probePage(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<PageProbe> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    const isHtml = contentType.includes('text/html') || /^\s*</.test(body);
    return {
      url,
      status: response.status,
      isHtml: response.ok && isHtml,
      html: response.ok && isHtml ? body : undefined,
    };
  } catch (err) {
    return { url, isHtml: false, error: errorMessage(err) };
  }
}

function detectLinkPayToken(page: PageProbe): LinkPayTokenProbe {
  if (!page.html) {
    return {
      url: page.url,
      found: false,
      indicators: [],
      status: page.status,
      error: page.error,
    };
  }
  const indicators = LINK_PAY_TOKEN_INDICATORS.filter(({ pattern }) =>
    pattern.test(page.html ?? ''),
  ).map(({ label }) => label);
  return {
    url: page.url,
    found: indicators.length > 0,
    indicators,
    status: page.status,
  };
}

function looksLikeLlmsTxt(body: string, contentType: string): boolean {
  const trimmed = body.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return false;
  if (contentType.includes('html') || /^\s*</.test(trimmed)) return false;
  if (
    contentType.includes('markdown') ||
    contentType.includes('text/plain') ||
    contentType.includes('text/markdown')
  ) {
    return true;
  }
  return trimmed.startsWith('#') || trimmed.startsWith('>');
}

async function fetchLlmsTxt(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<LlmsTxtFile | undefined> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    if (!response.ok) return undefined;
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    if (!looksLikeLlmsTxt(body, contentType)) return undefined;
    return { url, body };
  } catch {
    return undefined;
  }
}

async function probeLlmsTxt(
  fetchImpl: FetchLike,
  origin: string,
  extraUrls: string[],
  timeoutMs: number,
): Promise<LlmsTxtFile[]> {
  const candidates = [
    ...LLMS_TXT_PATHS.map((path) => `${origin}${path}`),
    ...extraUrls,
  ];
  const seen = new Set<string>();
  const files: LlmsTxtFile[] = [];
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    const file = await fetchLlmsTxt(fetchImpl, url, timeoutMs);
    if (file) files.push(file);
  }
  return files;
}

async function probeMcpWellKnown(
  fetchImpl: FetchLike,
  origin: string,
  timeoutMs: number,
): Promise<DiscoveredMcpServer[]> {
  const found: DiscoveredMcpServer[] = [];
  const seen = new Set<string>();
  for (const path of MCP_WELL_KNOWN_PATHS) {
    try {
      const url = `${origin}${path}`;
      const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      if (!response.ok) continue;
      const text = await response.text();
      let spec: unknown;
      try {
        spec = JSON.parse(text);
      } catch {
        continue;
      }
      for (const server of parseMcpManifest(spec)) {
        if (seen.has(server.url)) continue;
        seen.add(server.url);
        found.push(server);
      }
    } catch {
      // try the next well-known path
    }
  }
  return found;
}

function uniqueTools(tools: InspectTool[]): InspectTool[] {
  const seen = new Set<string>();
  const result: InspectTool[] = [];
  for (const tool of tools) {
    const key = `${tool.command}\0${tool.url ?? ''}\0${tool.method ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tool);
  }
  return result;
}

function tempoRequestCommand(url: string, httpMethod?: string): string {
  const quoted = quoteCommandArg(url);
  const verb = httpMethod?.toUpperCase();
  if (verb && verb !== 'GET') {
    return `tempo request -X ${verb} ${quoted}`;
  }
  return `tempo request ${quoted}`;
}

function linkCliMppPayCommand(url: string, httpMethod?: string): string {
  const quoted = quoteCommandArg(url);
  const verb = httpMethod?.toUpperCase();
  if (verb && verb !== 'GET') {
    return `link-cli mpp pay ${quoted} --method ${verb}`;
  }
  return `link-cli mpp pay ${quoted}`;
}

function machinePaymentTool(
  url: string,
  httpMethod: string | undefined,
  rail: 'stripe' | 'tempo',
  description: string,
): InspectTool {
  return {
    command:
      rail === 'stripe'
        ? linkCliMppPayCommand(url, httpMethod)
        : tempoRequestCommand(url, httpMethod),
    description,
    url,
    method: rail,
  };
}

function buildMachinePaymentTools(
  origin: string,
  mppMatch: MppOpenapiProbe | undefined,
  liveChallenge: LiveChallengeProbe,
  x402: EndpointProbe,
): InspectTool[] {
  const tools: InspectTool[] = [];
  const operations = mppMatch?.operations ?? [];

  for (const operation of operations) {
    const endpoint = new URL(operation.path, origin).toString();
    const rails = new Set(
      operation.offers.map((offer) => offer.method.toLowerCase()),
    );
    const summary =
      operation.description ??
      operation.summary ??
      mppMatch?.api_description ??
      mppMatch?.api_guidance ??
      'Pay with the machine payments protocol';

    if (rails.has('stripe')) {
      tools.push(
        machinePaymentTool(endpoint, operation.method, 'stripe', summary),
      );
    }
    if (rails.has('tempo')) {
      tools.push(
        machinePaymentTool(endpoint, operation.method, 'tempo', summary),
      );
    }
  }

  if (liveChallenge.found && liveChallenge.url) {
    const alreadyHasStripe = tools.some(
      (tool) => tool.method === 'stripe' && tool.url === liveChallenge.url,
    );
    if (!alreadyHasStripe) {
      tools.push(
        machinePaymentTool(
          liveChallenge.url,
          liveChallenge.method,
          'stripe',
          liveChallenge.description ??
            'Pay with the machine payments protocol to complete this 402 challenge',
        ),
      );
    }
  }

  if (tools.length === 0 && x402.found) {
    tools.push({
      command: tempoRequestCommand(x402.url),
      description: 'Pay with the machine payments protocol (x402)',
      url: x402.url,
    });
  }

  return uniqueTools(tools);
}

function buildMcpTools(
  ucp: UcpProbe,
  wellKnown: DiscoveredMcpServer[],
  llmsTxt: LlmsTxtFile[],
): InspectTool[] {
  const tools: InspectTool[] = [];

  for (const service of ucp.services ?? []) {
    if (service.transport !== 'mcp' || !service.endpoint) continue;
    tools.push({
      command: quoteCommandArg(service.endpoint),
      description: `Use MCP for ${service.service}`,
      url: service.endpoint,
    });
  }

  for (const server of wellKnown) {
    tools.push({
      command: quoteCommandArg(server.url),
      description:
        server.description ??
        (server.name
          ? `Use MCP (${server.name})`
          : 'Use MCP to interact with this service'),
      url: server.url,
    });
  }

  for (const file of llmsTxt) {
    for (const link of extractMarkdownMcpLinks(file.body)) {
      tools.push({
        command: quoteCommandArg(link.url),
        description: `Use MCP to ${link.name}`,
        url: link.url,
      });
    }
  }

  return uniqueTools(tools);
}

function buildBrowserCheckout(
  page: PageProbe,
  ucp: UcpProbe,
  linkPayToken: LinkPayTokenProbe,
): BrowserCheckoutTool | undefined {
  if (!page.isHtml) return undefined;

  const merchantAdvice: string[] = [];
  if (ucp.found) {
    merchantAdvice.push(
      'Merchant publishes a UCP profile — use the Universal Commerce Protocol for catalog, cart, and checkout.',
    );
  }
  if (linkPayToken.found) {
    merchantAdvice.push(
      'Checkout includes an AI-agent steering block. Create a card spend request and complete the Link Pay Token flow (enable "I am an AI agent" and inject the token from spend-request retrieve --include link_pay_token).',
    );
  }

  return {
    merchant_advice: merchantAdvice.join(' ') || undefined,
    general_advice:
      'Create a Link spend request with the default card credential type, get it approved, then enter the returned card details into the site checkout form.',
  };
}

function pickDisplayName(
  ucp: UcpProbe,
  llmsTxt: LlmsTxtFile[],
  mppMatch: MppOpenapiProbe | undefined,
): string | undefined {
  if (ucp.merchant) return ucp.merchant;
  for (const file of llmsTxt) {
    const title = parseLlmsTxtMeta(file.body).title;
    if (title) return title;
  }
  return mppMatch?.api_title;
}

function pickDescription(
  ucp: UcpProbe,
  llmsTxt: LlmsTxtFile[],
  mppMatch: MppOpenapiProbe | undefined,
): string | undefined {
  if (ucp.description) return ucp.description;
  for (const file of llmsTxt) {
    const summary = parseLlmsTxtMeta(file.body).summary;
    if (summary) return summary;
  }
  return mppMatch?.api_description;
}

// Prefer an operation that already declares a "stripe" offer; otherwise fall
// back to the first payment-required operation, so the live probe below has
// something concrete to try even when the spec doesn't break offers out by
// method (e.g. climate.stripe.dev's `protocols`-only style).
function pickPaymentOperation(
  operations: MppOperation[] | undefined,
): MppOperation | undefined {
  if (!operations || operations.length === 0) return undefined;
  return (
    operations.find((op) => op.offers.some((o) => o.method === 'stripe')) ??
    operations[0]
  );
}

// Some MPP endpoints validate the request body before returning 402 (e.g.
// climate.stripe.dev rejects a body missing "amount" with 400 rather than
// challenging for payment first), so an empty `{}` isn't always enough to
// reach the payment gate. Synthesize a value satisfying each required
// property's JSON Schema so the probe body passes basic validation.
function minimalValueForSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as Record<string, unknown>;
  if ('example' in s) return s.example;
  if ('default' in s) return s.default;
  switch (s.type) {
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 1;
    case 'string':
      return typeof s.minLength === 'number' && s.minLength > 0
        ? 'x'.repeat(s.minLength)
        : 'test';
    case 'boolean':
      return true;
    case 'array':
      return s.items ? [minimalValueForSchema(s.items)] : [];
    case 'object':
      return buildMinimalObject(s);
    default:
      return null;
  }
}

function buildMinimalObject(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return {};
  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : Object.keys(properties);

  const result: Record<string, unknown> = {};
  for (const key of required) {
    const propSchema = (properties as Record<string, unknown>)[key];
    result[key] = minimalValueForSchema(propSchema);
  }
  return result;
}

function buildProbeBody(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  if ((schema as Record<string, unknown>).type !== 'object') return undefined;
  return JSON.stringify(buildMinimalObject(schema as Record<string, unknown>));
}

// Ground-truth check for "stripe" support: actually hit the endpoint and read
// the WWW-Authenticate header of the 402 response, the same way `mpp pay`/
// `mpp decode` do. Used as a fallback when the openapi spec doesn't declare
// per-method offers explicitly (see extractOperations).
async function probeLiveChallenge(
  fetchImpl: FetchLike,
  origin: string,
  targetUrl: string,
  operation: MppOperation | undefined,
  timeoutMs: number,
): Promise<LiveChallengeProbe> {
  const url = operation
    ? new URL(operation.path, origin).toString()
    : targetUrl;
  const method = operation?.method ?? 'GET';
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : buildProbeBody(operation?.request_body_schema);
  const init: RequestInit =
    body !== undefined
      ? { method, body, headers: { 'Content-Type': 'application/json' } }
      : { method };

  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs, init);
    if (response.status !== 402) {
      return {
        attempted: true,
        url,
        method,
        status: response.status,
        found: false,
      };
    }
    const header = response.headers.get('www-authenticate');
    if (!header) {
      return {
        attempted: true,
        url,
        method,
        status: 402,
        found: false,
        error: 'missing WWW-Authenticate header',
      };
    }
    try {
      const decoded = decodeStripeChallenge(header);
      return {
        attempted: true,
        url,
        method,
        status: 402,
        found: true,
        network_id: decoded.network_id,
        description: decoded.description,
      };
    } catch (err) {
      return {
        attempted: true,
        url,
        method,
        status: 402,
        found: false,
        error: errorMessage(err),
      };
    }
  } catch (err) {
    return {
      attempted: false,
      url,
      method,
      found: false,
      error: errorMessage(err),
    };
  }
}

function toInspectResult(input: {
  origin: string;
  page: PageProbe;
  ucp: UcpProbe;
  mppMatch: MppOpenapiProbe | undefined;
  liveChallenge: LiveChallengeProbe;
  x402: EndpointProbe;
  linkPayToken: LinkPayTokenProbe;
  llmsTxt: LlmsTxtFile[];
  mcpServers: DiscoveredMcpServer[];
}): InspectResult {
  const machinePayments = buildMachinePaymentTools(
    input.origin,
    input.mppMatch,
    input.liveChallenge,
    input.x402,
  );
  const mcp = buildMcpTools(input.ucp, input.mcpServers, input.llmsTxt);
  const browserCheckout = buildBrowserCheckout(
    input.page,
    input.ucp,
    input.linkPayToken,
  );

  const result: InspectResult = {
    display_name: pickDisplayName(input.ucp, input.llmsTxt, input.mppMatch),
    description: pickDescription(input.ucp, input.llmsTxt, input.mppMatch),
    url: input.origin,
    llms_txt: input.llmsTxt.map((file) => file.url),
    available_tools: {
      machine_payments: machinePayments,
      mcp,
      browser_checkout: browserCheckout,
    },
  };

  return compactInspectResult(sanitizeDeep(result));
}

export async function runInspect(
  url: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<InspectResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  const origin = `${parsed.protocol}//${parsed.host}`;

  const [mppOpenapi, x402, ucp, page, wellKnownMcp] = await Promise.all([
    probeMppOpenapi(fetchImpl, origin, timeoutMs),
    probeJsonEndpoint(fetchImpl, `${origin}/.well-known/x402.json`, timeoutMs),
    probeUcpEndpoint(fetchImpl, `${origin}/.well-known/ucp`, timeoutMs),
    probePage(fetchImpl, url, timeoutMs),
    probeMcpWellKnown(fetchImpl, origin, timeoutMs),
  ]);

  const extraLlmsUrls = page.html ? extractLlmsTxtUrls(page.html, origin) : [];
  const llmsTxt = await probeLlmsTxt(
    fetchImpl,
    origin,
    extraLlmsUrls,
    timeoutMs,
  );

  const mppMatch = mppOpenapi.find((p) => p.found);
  const operation = pickPaymentOperation(mppMatch?.operations);

  // Only fall back to a live 402 probe when the openapi spec didn't already
  // give us a confident "stripe" answer -- e.g. climate.stripe.dev's spec
  // declares `protocols: ["mpp","x402"]` with no per-method offers, so the
  // static check alone can't tell whether "stripe" is actually accepted.
  const liveChallenge = mppMatch?.offers_stripe
    ? {
        attempted: false as const,
        found: false as const,
      }
    : await probeLiveChallenge(fetchImpl, origin, url, operation, timeoutMs);

  const linkPayToken = detectLinkPayToken(page);

  return toInspectResult({
    origin,
    page,
    ucp,
    mppMatch,
    liveChallenge,
    x402,
    linkPayToken,
    llmsTxt,
    mcpServers: wellKnownMcp,
  });
}
