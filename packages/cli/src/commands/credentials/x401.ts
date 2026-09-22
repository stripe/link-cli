import { z } from 'incur';
import { sanitizeText } from '../../utils/sanitize-text';
import { dcqlQuerySchema, presentDcqlCredential } from './openid4vp';

const X401_VERSION = '0.2.0';
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

const unsignedRequestSchema = z
  .object({
    response_type: z.literal('vp_token'),
    response_mode: z.literal('dc_api'),
    nonce: z.string().min(1),
    dcql_query: dcqlQuerySchema,
    client_metadata: z.unknown().optional(),
  })
  .strict();

const payloadSchema = z
  .object({
    scheme: z.literal('x401'),
    version: z.literal(X401_VERSION),
    credential_requirements: z
      .object({
        digital: z
          .object({
            requests: z
              .array(
                z
                  .object({
                    protocol: z.literal('openid4vp-v1-unsigned'),
                    data: unsignedRequestSchema,
                  })
                  .strict(),
              )
              .length(1),
          })
          .strict(),
      })
      .strict(),
    request_id: z.string().min(1).optional(),
    satisfied_requirements: z.array(z.string()).optional(),
    oauth: z.unknown().optional(),
    payment: z.unknown().optional(),
  })
  .strict();

export interface X401PresentOptions {
  resourceUrl: string;
  submit?: boolean;
}

function assertSafeUrl(value: string): URL {
  const url = new URL(value);
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      'x401 resource URL must use HTTPS (HTTP is allowed for loopback only).',
    );
  }
  return url;
}

function decodeHeader(value: string, name: string): unknown {
  if (
    value === '' ||
    value.includes(',') ||
    value.includes('=') ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    Buffer.byteLength(value, 'ascii') > MAX_HEADER_BYTES
  ) {
    throw new Error(`${name} is not a single unpadded base64url value.`);
  }
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${name} does not contain valid UTF-8 JSON.`);
  }
}

function encodeHeader(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

async function readBounded(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('x401 response is too large.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('x401 response is too large.');
  }
  return new TextDecoder().decode(bytes);
}

function responseBody(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorDescription(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const description = (value as { error_description?: unknown })
    .error_description;
  return typeof description === 'string' ? sanitizeText(description) : '';
}

export async function presentX401Resource(
  options: X401PresentOptions,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
) {
  const resourceUrl = assertSafeUrl(options.resourceUrl);
  const initial = await fetchImpl(resourceUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  const proofRequest = initial.headers.get('proof-request');
  if (!proofRequest) {
    throw new Error(
      `Resource response did not contain PROOF-REQUEST (HTTP ${initial.status}).`,
    );
  }
  const parsed = payloadSchema.safeParse(
    decodeHeader(proofRequest, 'PROOF-REQUEST'),
  );
  if (!parsed.success) {
    throw new Error(
      'Unsupported x401 payload: expected one unsigned OpenID4VP dc+sd-jwt request.',
    );
  }

  const request = parsed.data.credential_requirements.digital.requests[0];
  const fulfilled = await presentDcqlCredential({
    audience: `origin:${resourceUrl.origin}/`,
    nonce: request.data.nonce,
    dcqlQuery: request.data.dcql_query,
  });
  const resultArtifact = {
    ...(parsed.data.request_id ? { request_id: parsed.data.request_id } : {}),
    credential_result: {
      protocol: request.protocol,
      data: { vp_token: fulfilled.vpToken },
    },
  };
  const proofResponse = encodeHeader(resultArtifact);
  if (!options.submit) {
    return {
      protocol: 'x401' as const,
      version: X401_VERSION,
      resource_url: resourceUrl.toString(),
      request_id: parsed.data.request_id,
      proof_response: proofResponse,
    };
  }

  const retried = await fetchImpl(resourceUrl, {
    headers: {
      Accept: 'application/json',
      'PROOF-RESPONSE': proofResponse,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  const body = responseBody(await readBounded(retried));
  if (!retried.ok) {
    const proofResult = retried.headers.get('proof-result');
    const decodedResult = proofResult
      ? decodeHeader(proofResult, 'PROOF-RESULT')
      : undefined;
    const description = errorDescription(decodedResult);
    throw new Error(
      `x401 resource retry returned HTTP ${retried.status}${description ? `: ${description}` : ''}`,
    );
  }
  return {
    protocol: 'x401' as const,
    version: X401_VERSION,
    submitted: true as const,
    resource_url: resourceUrl.toString(),
    status: retried.status,
    response: body,
  };
}
