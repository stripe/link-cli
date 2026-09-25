export interface IdentityProvider {
  takeAttestation(): Promise<{ authorization: string }>;
  presentIdentityCredential(input: {
    aud: string;
    nonce: string;
    claim: string[];
  }): Promise<{ presentation: string }>;
}

export interface IdentityChallenge {
  aud: string;
  nonce: string;
  claims: string[];
}

export interface IdentityDisclosureAuthorization {
  audience: string;
  claims: readonly string[];
}

export interface CreateIdentityChallengeHeadersParams {
  response: Response;
  requestUrl: string;
  requestHeaders: HeadersInit;
  identityProvider: IdentityProvider;
  disclosureAuthorization?: IdentityDisclosureAuthorization;
}

export interface IdentityChallengeHeaders {
  headers: Headers;
  ephemeralHeaderNames: string[];
}

export interface StrippedIdentityHeaders {
  headers: Headers;
  hadIdentityCredentials: boolean;
}

const LINK_ISSUER = 'https://api.link.com';
const MAX_CHALLENGE_BODY_BYTES = 64 * 1024;

/** Returns the authentication schemes in a WWW-Authenticate field value. */
export function authenticationSchemes(header: string): Set<string> {
  const schemes = new Set<string>();
  let quoted = false;
  let escaped = false;
  let segmentStart = 0;

  const inspectSegment = (segment: string, first: boolean) => {
    const trimmed = segment.trim();
    const match = trimmed.match(/^([^\s=,]+)(?:\s|$)/);
    if (!match) return;
    const scheme = match[1];
    if (!scheme) return;
    // The first segment always begins an authentication challenge. Later
    // segments beginning with `name=` are parameters on the prior challenge.
    if (first || !trimmed.startsWith(`${scheme}=`)) {
      schemes.add(scheme.toLowerCase());
    }
  };

  let first = true;
  for (let index = 0; index <= header.length; index++) {
    const character = header[index];
    if (index === header.length || (character === ',' && !quoted)) {
      inspectSegment(header.slice(segmentStart, index), first);
      first = false;
      segmentStart = index + 1;
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (character === '\\' && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    }
  }
  return schemes;
}

/** Parses and validates Link's selective-disclosure identity challenge. */
export async function parseIdentityChallenge(
  response: Response,
  requestUrl: string,
): Promise<IdentityChallenge> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/problem+json')) {
    throw new Error(
      'Identity-Presentation challenge must use application/problem+json',
    );
  }

  let value: unknown;
  try {
    const body = await response.clone().text();
    if (new TextEncoder().encode(body).byteLength > MAX_CHALLENGE_BODY_BYTES) {
      throw new Error();
    }
    value = JSON.parse(body);
  } catch {
    throw new Error('Identity-Presentation challenge body is invalid');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Identity-Presentation challenge body is invalid');
  }
  const challenge = value as Record<string, unknown>;
  const claims = challenge.claims;
  const formats = challenge.formats;
  const trustedIssuers = challenge.trusted_issuers;
  if (
    challenge.type !== 'urn:aap:claims-required' ||
    typeof challenge.aud !== 'string' ||
    typeof challenge.nonce !== 'string' ||
    challenge.nonce.length === 0 ||
    !Array.isArray(claims) ||
    claims.length === 0 ||
    claims.some((claim) => typeof claim !== 'string' || claim.length === 0) ||
    new Set(claims).size !== claims.length ||
    !Array.isArray(formats) ||
    !formats.includes('dc+sd-jwt') ||
    !Array.isArray(trustedIssuers) ||
    trustedIssuers.length !== 1 ||
    trustedIssuers[0] !== LINK_ISSUER
  ) {
    throw new Error('Identity-Presentation challenge body is invalid');
  }

  const expectedAudience = new URL(requestUrl).origin;
  if (challenge.aud !== expectedAudience) {
    throw new Error(
      'Identity-Presentation challenge audience does not match the request origin',
    );
  }

  return {
    aud: challenge.aud,
    nonce: challenge.nonce,
    claims: claims as string[],
  };
}

/**
 * Creates the headers needed to answer a supported Link identity challenge.
 * The presentation is built before a one-time attestation is consumed.
 */
export async function createIdentityChallengeHeaders({
  response,
  requestUrl,
  requestHeaders,
  identityProvider,
  disclosureAuthorization,
}: CreateIdentityChallengeHeadersParams): Promise<IdentityChallengeHeaders | null> {
  if (response.status !== 401) return null;

  const wwwAuthenticate = response.headers.get('www-authenticate');
  if (!wwwAuthenticate) return null;
  const schemes = authenticationSchemes(wwwAuthenticate);
  const needsAttestation = schemes.has('privatetoken');
  const needsClaims = schemes.has('identity-presentation');
  if (!needsAttestation && !needsClaims) return null;

  const headers = new Headers(requestHeaders);
  const ephemeralHeaderNames: string[] = [];

  if (needsClaims) {
    const challenge = await parseIdentityChallenge(response, requestUrl);
    if (!disclosureAuthorization) {
      throw new Error(
        'Identity-Presentation challenge requires explicit claim authorization',
      );
    }
    if (challenge.aud !== disclosureAuthorization.audience) {
      throw new Error(
        'Identity-Presentation challenge audience was not explicitly authorized',
      );
    }
    const authorizedClaims = new Set(disclosureAuthorization.claims);
    const unauthorizedClaims = challenge.claims.filter(
      (claim) => !authorizedClaims.has(claim),
    );
    if (unauthorizedClaims.length > 0) {
      throw new Error(
        'Identity-Presentation challenge requested claims that were not explicitly authorized',
      );
    }
    const { presentation } = await identityProvider.presentIdentityCredential({
      aud: challenge.aud,
      nonce: challenge.nonce,
      claim: challenge.claims,
    });
    headers.set('Identity-Presentation', presentation);
    ephemeralHeaderNames.push('identity-presentation');
  }
  if (needsAttestation) {
    const { authorization } = await identityProvider.takeAttestation();
    headers.set('Authorization', authorization);
    ephemeralHeaderNames.push('authorization');
  }

  return { headers, ephemeralHeaderNames };
}

/** Removes short-lived Link identity proofs before requesting a fresh nonce. */
export function stripIdentityCredentialHeaders(
  requestHeaders: HeadersInit,
): StrippedIdentityHeaders {
  const headers = new Headers(requestHeaders);
  const authorization = headers.get('authorization');
  const hasPrivateToken =
    authorization?.toLowerCase().startsWith('privatetoken ') ?? false;
  const hasPresentation = headers.has('identity-presentation');

  if (hasPrivateToken) headers.delete('authorization');
  headers.delete('identity-presentation');

  return {
    headers,
    hadIdentityCredentials: hasPrivateToken || hasPresentation,
  };
}
