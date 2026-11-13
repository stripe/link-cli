import { isIP } from 'node:net';
import { z } from 'incur';
import { sanitizeDeep, sanitizeText } from '../../utils/sanitize-text';

const INSPECT_ENDPOINT = 'https://api.stripe.com/v1/directory/inspect';
const DEFAULT_TIMEOUT_MS = 5000;
const STRIPE_API_VERSION = '2026-10-28.preview';

const actionSchema = z.looseObject({
  type: z.string(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  payment_mechanisms: z.array(z.string()).optional(),
  well_known_endpoint: z.string().optional(),
  merchant_advice: z.string().optional(),
  priority_order: z.number().int().optional(),
});
const resultSchema = z.looseObject({
  id: z.string().min(1),
  object: z.literal('directory.inspect_result'),
  url: z.string(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  network_business_profile: z.string().optional(),
  documentation: z.array(z.string()).optional(),
  context: z.string().optional(),
  agent_integration_actions: z.array(actionSchema).optional(),
  suggested_payment_mechanisms: z
    .record(
      z.string(),
      z.looseObject({
        agent_tools: z.record(
          z.string(),
          z.looseObject({
            setup: z.string(),
            agent_prompt: z.string(),
            supported_currencies: z.array(z.string()),
          }),
        ),
      }),
    )
    .optional(),
});

// Preserve additive API fields. The CLI does not infer capabilities or advice.
export interface InspectResult extends Record<string, unknown> {
  id: string;
  object: 'directory.inspect_result';
  url: string;
}

export function buildInspectUrl(value: string): URL {
  const merchantUrl = value.trim();
  let hostname: string;
  try {
    const parsed = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(merchantUrl)
        ? merchantUrl
        : `https://${merchantUrl}`,
    );
    if (
      !merchantUrl ||
      /\s/.test(merchantUrl) ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('Invalid URL');
    }
    hostname = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    if (
      isIP(hostname) ||
      hostname.length > 253 ||
      !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/.test(
        hostname,
      ) ||
      hostname.endsWith('.localhost')
    ) {
      throw new Error('Invalid hostname');
    }
  } catch {
    throw new Error(
      'URL must be an HTTP(S) URL or merchant domain without credentials',
    );
  }
  const requestUrl = new URL(INSPECT_ENDPOINT);
  // Send only the business hostname, never checkout session data.
  requestUrl.searchParams.set('url', hostname);
  return requestUrl;
}

export async function runInspect(
  url: string,
  opts: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    userAgent?: string;
  } = {},
): Promise<InspectResult> {
  const requestUrl = buildInspectUrl(url);
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  let body: string;
  try {
    response = await fetchImpl(requestUrl, {
      method: 'GET',
      // This public endpoint never receives Link tokens or Stripe credentials.
      headers: {
        'User-Agent': opts.userAgent ?? 'link-cli',
        'Stripe-Version': STRIPE_API_VERSION,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new Error('Directory inspection timed out', { cause: error });
    }
    throw new Error('Directory inspect request failed', { cause: error });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) {
      throw new Error(`Directory inspect failed (HTTP ${response.status})`);
    }
    throw new Error('Directory inspect returned an invalid response');
  }

  if (!response.ok) {
    const error =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>).error
        : undefined;
    const message =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>).message
        : error;
    throw new Error(
      typeof message === 'string'
        ? sanitizeText(message)
        : `Directory inspect failed (HTTP ${response.status})`,
    );
  }
  const result = resultSchema.safeParse(payload);
  if (!result.success) {
    throw new Error('Directory inspect returned an invalid response');
  }
  if (result.data.url !== requestUrl.searchParams.get('url')) {
    throw new Error(
      'Directory inspect returned a mismatched merchant hostname',
    );
  }
  return sanitizeDeep(result.data);
}
