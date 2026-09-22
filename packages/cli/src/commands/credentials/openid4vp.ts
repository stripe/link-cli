import { z } from 'incur';
import { sanitizeText } from '../../utils/sanitize-text';
import { presentIdentityCredential } from './present';

const MAX_RESPONSE_BYTES = 256 * 1024;

export const credentialQuerySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    format: z.literal('dc+sd-jwt'),
    multiple: z.literal(false).optional(),
    meta: z
      .object({
        vct_values: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    claims: z
      .array(
        z
          .object({
            path: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const dcqlQuerySchema = z
  .object({
    credentials: z.array(credentialQuerySchema).length(1),
  })
  .strict();

const challengeSchema = z
  .object({
    client_id: z.string().min(1),
    response_uri: z.url(),
    response_type: z.literal('vp_token'),
    response_mode: z.literal('direct_post'),
    nonce: z.string().min(1),
    state: z.string().min(1),
    dcql_query: dcqlQuerySchema,
    client_metadata: z.unknown().optional(),
  })
  .strict();

export interface OpenId4VpPresentOptions {
  challengeUrl: string;
  submit?: boolean;
}

function assertSafeUrl(value: string, label: string): URL {
  const url = new URL(value);
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      `${label} must use HTTPS (HTTP is allowed for loopback only).`,
    );
  }
  return url;
}

async function readBounded(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('OpenID4VP response is too large.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('OpenID4VP response is too large.');
  }
  return new TextDecoder().decode(bytes);
}

async function fetchChallenge(
  challengeUrl: string,
  fetchImpl: typeof globalThis.fetch,
) {
  assertSafeUrl(challengeUrl, 'OpenID4VP challenge URL');
  const response = await fetchImpl(challengeUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(
      `OpenID4VP challenge endpoint returned HTTP ${response.status}.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(await readBounded(response));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('OpenID4VP challenge endpoint did not return JSON.');
    }
    throw error;
  }
  const parsed = challengeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      'Unsupported OpenID4VP challenge: expected one direct_post dc+sd-jwt DCQL credential query.',
    );
  }
  return parsed.data;
}

function topLevelClaims(
  query: z.infer<typeof credentialQuerySchema>,
): string[] {
  const claims = query.claims.map(({ path }) => {
    if (path.length !== 1) {
      throw new Error(
        'Unsupported OpenID4VP challenge: only top-level DCQL claim paths are supported.',
      );
    }
    return path[0];
  });
  if (new Set(claims).size !== claims.length) {
    throw new Error(
      'Unsupported OpenID4VP challenge: duplicate DCQL claims are not allowed.',
    );
  }
  return claims;
}

export async function presentDcqlCredential(options: {
  audience: string;
  nonce: string;
  dcqlQuery: z.infer<typeof dcqlQuerySchema>;
}) {
  const query = options.dcqlQuery.credentials[0];
  const { presentation } = await presentIdentityCredential({
    aud: options.audience,
    nonce: options.nonce,
    claim: topLevelClaims(query),
  });
  const vct = presentationVct(presentation);
  if (!vct || !query.meta.vct_values.includes(vct)) {
    throw new Error(
      'Saved identity credential does not match the OpenID4VP DCQL credential type.',
    );
  }
  return {
    queryId: query.id,
    presentation,
    vpToken: { [query.id]: [presentation] },
  };
}

function presentationVct(presentation: string): string | undefined {
  try {
    const payloadSegment = presentation.split('~')[0]?.split('.')[1];
    if (!payloadSegment) return undefined;
    const payload = JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf8'),
    ) as { vct?: unknown };
    return typeof payload.vct === 'string' ? payload.vct : undefined;
  } catch {
    return undefined;
  }
}

async function submitResponse(
  responseUri: string,
  authorizationResponse: { vp_token: string; state: string },
  fetchImpl: typeof globalThis.fetch,
) {
  const response = await fetchImpl(responseUri, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(authorizationResponse).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  const text = await readBounded(response);
  let body: unknown = text;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    // A successful direct_post response is allowed to be non-JSON.
  }
  if (!response.ok) {
    const description =
      body &&
      typeof body === 'object' &&
      typeof (body as { error_description?: unknown }).error_description ===
        'string'
        ? `: ${sanitizeText((body as { error_description: string }).error_description)}`
        : '';
    throw new Error(
      `OpenID4VP response endpoint returned HTTP ${response.status}${description}`,
    );
  }
  return { status: response.status, body };
}

export async function presentOpenId4VpChallenge(
  options: OpenId4VpPresentOptions,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
) {
  const challenge = await fetchChallenge(options.challengeUrl, fetchImpl);
  const responseUri = assertSafeUrl(
    challenge.response_uri,
    'OpenID4VP response_uri',
  ).toString();
  if (challenge.client_id !== `redirect_uri:${responseUri}`) {
    throw new Error(
      'Unsupported OpenID4VP challenge: client_id must use the redirect_uri prefix and exactly match response_uri.',
    );
  }

  const fulfilled = await presentDcqlCredential({
    audience: challenge.client_id,
    nonce: challenge.nonce,
    dcqlQuery: challenge.dcql_query,
  });

  const authorizationResponse = {
    vp_token: JSON.stringify(fulfilled.vpToken),
    state: challenge.state,
  };
  if (!options.submit) {
    return {
      protocol: 'openid4vp' as const,
      response_uri: responseUri,
      content_type: 'application/x-www-form-urlencoded' as const,
      authorization_response: authorizationResponse,
    };
  }

  const submitted = await submitResponse(
    responseUri,
    authorizationResponse,
    fetchImpl,
  );
  return {
    protocol: 'openid4vp' as const,
    submitted: true as const,
    response_uri: responseUri,
    status: submitted.status,
    response: submitted.body,
  };
}
