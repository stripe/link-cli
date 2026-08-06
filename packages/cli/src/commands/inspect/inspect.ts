import { sanitizeDeep } from '../../utils/sanitize-text';
import { decodeStripeChallenge } from '../mpp/decode';

const DEFAULT_TIMEOUT_MS = 5000;

export type StrategyName =
  | 'ucp'
  | 'shared_payment_token'
  | 'link_pay_token'
  | 'card';

export type CredentialType = 'shared_payment_token' | 'card';

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

export interface LinkPayTokenProbe {
  url: string;
  found: boolean;
  indicators: string[];
  status?: number;
  error?: string;
}

export interface Strategy {
  name: StrategyName;
  label: string;
  detected: boolean;
  priority: number;
  evidence: string[];
}

export interface RecommendedOperation {
  path: string;
  method: string;
  description?: string;
  request_body_schema?: unknown;
}

export interface RecommendedUcpProfile {
  profile_url: string;
  merchant?: string;
  description?: string;
  services: UcpServiceEntry[];
  capabilities: UcpCapabilityEntry[];
  payment_handlers: UcpPaymentHandlerEntry[];
}

export interface InspectResult {
  url: string;
  hostname: string;
  probes: {
    mpp_openapi: MppOpenapiProbe[];
    x402: EndpointProbe;
    ucp: UcpProbe;
    link_pay_token: LinkPayTokenProbe;
    live_challenge: LiveChallengeProbe;
  };
  strategies: Strategy[];
  recommendation: {
    strategy: StrategyName;
    credential_type: CredentialType | null;
    reason: string;
    instruction: string;
    operation?: RecommendedOperation;
    profile?: RecommendedUcpProfile;
  };
  _next?: {
    command: string;
    description: string;
  };
}

type FetchLike = typeof fetch;

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

async function probeLinkPayToken(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
): Promise<LinkPayTokenProbe> {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    if (!response.ok) {
      return {
        url,
        found: false,
        indicators: [],
        status: response.status,
      };
    }
    const html = await response.text();
    const indicators = LINK_PAY_TOKEN_INDICATORS.filter(({ pattern }) =>
      pattern.test(html),
    ).map(({ label }) => label);
    return {
      url,
      found: indicators.length > 0,
      indicators,
      status: response.status,
    };
  } catch (err) {
    return { url, found: false, indicators: [], error: errorMessage(err) };
  }
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

const RECOMMENDATION_REASONS: Record<StrategyName, string> = {
  ucp: 'Merchant speaks the Universal Commerce Protocol (UCP) — use the ucp CLI for full catalog/cart/checkout support.',
  shared_payment_token:
    'Merchant exposes a Machine Payment Protocol (MPP) endpoint that accepts the "stripe" payment method — create a spend request and use "link-cli mpp pay" to complete the 402 flow.',
  link_pay_token:
    'Checkout page includes an AI-agent steering block — use the Link Pay Token flow (requires browser automation) to pay without exposing card numbers.',
  card: "No agent-native payment protocol detected — use the default 'card' credential type and complete checkout on the page's own payment form.",
};

// Only 'card' and 'shared_payment_token' map to link-cli spend-request's
// --credential-type flag; 'ucp' is a fully separate protocol/CLI, and
// 'link_pay_token' rides on a 'card' spend request under the hood.
const RECOMMENDATION_CREDENTIAL_TYPES: Record<
  StrategyName,
  CredentialType | null
> = {
  ucp: null,
  shared_payment_token: 'shared_payment_token',
  link_pay_token: 'card',
  card: 'card',
};

const RECOMMENDATION_INSTRUCTIONS: Record<StrategyName, string> = {
  ucp: 'Run `ucp discover --business <origin>` to confirm merchant capabilities, then use ucp cart/checkout commands against the endpoints in `recommendation.profile.services`/`capabilities` to complete the purchase.',
  shared_payment_token:
    'Create a spend request with `--credential-type shared_payment_token`, get it approved, then run `link-cli mpp pay <url> --spend-request-id <id>` against the operation in `recommendation.operation` (and `--data`/`--method` matching its `request_body_schema`) to complete the 402 flow.',
  link_pay_token:
    'Create a spend request (default `card` credential type), get it approved, open the checkout page, and follow the Link Pay Token flow (check the "I am an AI agent" checkbox, inject the token from `spend-request retrieve <id> --include link_pay_token`).',
  card: 'Create a spend request with the default `card` credential type, get it approved, then run `spend-request retrieve <id> --include card` and enter the returned card details into the checkout form.',
};

function buildNextAction(
  strategy: StrategyName,
  origin: string,
): InspectResult['_next'] {
  if (strategy === 'ucp') {
    return {
      command: `ucp discover --business ${origin}`,
      description: 'Confirm UCP capabilities for this merchant',
    };
  }
  return undefined;
}

function buildUcpEvidence(ucpProbe: UcpProbe): string[] {
  if (!ucpProbe.found) return [];
  const merchant = ucpProbe.merchant ? ` for "${ucpProbe.merchant}"` : '';
  const serviceCount = ucpProbe.services?.length ?? 0;
  const capabilityCount = ucpProbe.capabilities?.length ?? 0;
  return [
    `${ucpProbe.url} responded with a UCP merchant profile${merchant} (${serviceCount} service${serviceCount === 1 ? '' : 's'}, ${capabilityCount} capabilit${capabilityCount === 1 ? 'y' : 'ies'})`,
  ];
}

function buildMppEvidence(
  mppMatch: MppOpenapiProbe | undefined,
  liveChallenge: LiveChallengeProbe,
): string[] {
  const evidence: string[] = [];
  if (mppMatch) {
    const methods = mppMatch.offered_methods ?? [];
    if (mppMatch.offers_stripe) {
      const others = methods.filter((m) => m !== 'stripe');
      evidence.push(
        `${mppMatch.url} offers the "stripe" payment method${others.length ? ` (alongside ${others.join(', ')})` : ''}`,
      );
    } else {
      evidence.push(
        `${mppMatch.url} responded with an MPP spec but does not explicitly declare the "stripe" payment method${methods.length ? ` (offers: ${methods.join(', ')})` : ' (no per-method offers declared)'}`,
      );
    }
  }
  if (liveChallenge.found) {
    evidence.push(
      `Live ${liveChallenge.method} ${liveChallenge.url} returned HTTP 402 with a "stripe" payment challenge (network_id: ${liveChallenge.network_id})`,
    );
  } else if (liveChallenge.attempted && !mppMatch?.offers_stripe) {
    evidence.push(
      `Live ${liveChallenge.method} ${liveChallenge.url} did not confirm stripe support (status: ${liveChallenge.status ?? 'error'}${liveChallenge.error ? `, ${liveChallenge.error}` : ''})`,
    );
  }
  return evidence;
}

function buildStrategies(
  probes: InspectResult['probes'],
  mppMatch: MppOpenapiProbe | undefined,
): Strategy[] {
  const mppOffersStripe = mppMatch?.offers_stripe ?? false;
  const detected = mppOffersStripe || probes.live_challenge.found;

  const strategies: Strategy[] = [
    {
      name: 'ucp',
      label: 'Universal Commerce Protocol (UCP)',
      detected: probes.ucp.found,
      priority: 1,
      evidence: buildUcpEvidence(probes.ucp),
    },
    {
      name: 'shared_payment_token',
      label: 'Machine Payment Protocol (MPP) shared payment token',
      detected,
      priority: 2,
      evidence: buildMppEvidence(mppMatch, probes.live_challenge),
    },
    {
      name: 'link_pay_token',
      label: 'Link Pay Token (AI-agent steering block)',
      detected: probes.link_pay_token.found,
      priority: 3,
      evidence: probes.link_pay_token.indicators,
    },
    {
      name: 'card',
      label: 'Virtual card (default fallback)',
      detected: true,
      priority: 4,
      evidence: [
        'Always available via Link — no merchant-side support required',
      ],
    },
  ];

  return strategies.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    return a.priority - b.priority;
  });
}

function buildRecommendedOperation(
  strategy: StrategyName,
  operation: MppOperation | undefined,
  liveChallenge: LiveChallengeProbe,
): RecommendedOperation | undefined {
  if (strategy !== 'shared_payment_token') return undefined;
  if (operation) {
    return {
      path: operation.path,
      method: operation.method,
      description: operation.description ?? operation.summary,
      request_body_schema: operation.request_body_schema,
    };
  }
  if (liveChallenge.found && liveChallenge.url) {
    return {
      path: new URL(liveChallenge.url).pathname,
      method: liveChallenge.method ?? 'GET',
    };
  }
  return undefined;
}

function buildRecommendedProfile(
  strategy: StrategyName,
  ucpProbe: UcpProbe,
): RecommendedUcpProfile | undefined {
  if (strategy !== 'ucp' || !ucpProbe.found) return undefined;
  return {
    profile_url: ucpProbe.url,
    merchant: ucpProbe.merchant,
    description: ucpProbe.description,
    services: ucpProbe.services ?? [],
    capabilities: ucpProbe.capabilities ?? [],
    payment_handlers: ucpProbe.payment_handlers ?? [],
  };
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

  const [mppOpenapi, x402, ucp, linkPayToken] = await Promise.all([
    probeMppOpenapi(fetchImpl, origin, timeoutMs),
    probeJsonEndpoint(fetchImpl, `${origin}/.well-known/x402.json`, timeoutMs),
    probeUcpEndpoint(fetchImpl, `${origin}/.well-known/ucp`, timeoutMs),
    probeLinkPayToken(fetchImpl, url, timeoutMs),
  ]);

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

  const probes: InspectResult['probes'] = {
    mpp_openapi: mppOpenapi,
    x402,
    ucp,
    link_pay_token: linkPayToken,
    live_challenge: liveChallenge,
  };

  const strategies = buildStrategies(probes, mppMatch);
  const top = strategies[0];

  const result: InspectResult = {
    url,
    hostname: parsed.hostname,
    probes,
    strategies,
    recommendation: {
      strategy: top.name,
      credential_type: RECOMMENDATION_CREDENTIAL_TYPES[top.name],
      reason: RECOMMENDATION_REASONS[top.name],
      instruction: RECOMMENDATION_INSTRUCTIONS[top.name],
      operation: buildRecommendedOperation(top.name, operation, liveChallenge),
      profile: buildRecommendedProfile(top.name, ucp),
    },
    _next: buildNextAction(top.name, origin),
  };

  return sanitizeDeep(result);
}
