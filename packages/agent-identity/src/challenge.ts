/**
 * Challenge construction for both lanes.
 */

import { encodeTokenChallenge } from './attestation.js';
import {
  padBase64url,
  toBase64url,
  toBase64urlPadded,
} from './internal/bytes.js';
import { sha256 } from './internal/crypto.js';
import { type LinkIssuer, TOKEN_TYPE_BLIND_RSA } from './issuer.js';

export interface AttestationChallenge {
  /**
   * `WWW-Authenticate` values to send with a 401. One entry per accepted issuer
   * key, all carrying the same stable TokenChallenge and differing only in
   * `token-key`, so an agent holding a pooled token minted under any advertised
   * key can answer.
   *
   * Send each as its own `WWW-Authenticate` header field. Do not join them with
   * commas: a comma-joined value is ambiguous to parse, because an auth-param
   * list and a challenge list use the same separator.
   */
  wwwAuthenticate: string[];
  /** base64url SHA-256 of the stable TokenChallenge, for logging or caching. */
  challengeDigest: string;
}

export interface CreateAttestationChallengeOptions {
  /** Advertised challenge lifetime in seconds. Does not expire the token or enforce single use. */
  maxAgeSeconds?: number;
}

/**
 * Builds the 401 challenge that asks an agent for an AAT, trusting Link.
 *
 * The TokenChallenge is stable by design: a fixed `issuer_name`, an empty
 * `origin_info`, and an empty `redemption_context`. That is what lets an agent
 * answer from a pre-provisioned pool with no issuance round trip. Do not vary it
 * per request; a fresh per-request challenge invalidates every pooled token.
 */
export async function createAttestationChallenge(
  issuer: LinkIssuer,
  options: CreateAttestationChallengeOptions = {},
): Promise<AttestationChallenge> {
  const maxAge = options.maxAgeSeconds ?? 300;
  const challenge = encodeTokenChallenge({ issuerName: issuer.issuerName });
  // RFC 9577 section 2.1.2 requires the `challenge` and `token-key` parameters to
  // carry base64url padding, following RFC 4648 section 3.2 default behaviour.
  // That is the opposite of the JOSE convention used everywhere else here, which
  // is why these two are encoded separately rather than reusing `toBase64url`.
  const challengeB64 = toBase64urlPadded(challenge);
  const digest = toBase64url(await sha256(challenge));

  const keys = await issuer.advertisableKeys();
  if (keys.length === 0) {
    throw new Error(
      `no usable ${TOKEN_TYPE_BLIND_RSA} token keys published by ${issuer.issuer}`,
    );
  }

  // Values are quoted. base64url of a 32-byte digest or a 294-byte SPKI is
  // frequently padded, and `=` is not a `token` character in RFC 9110, so an
  // unquoted auth-param carrying padded base64url is not valid HTTP.
  const wwwAuthenticate = keys.map(
    (key) =>
      `PrivateToken challenge="${challengeB64}", token-key="${padBase64url(key.spkiBase64url)}", max-age=${maxAge}`,
  );

  return { wwwAuthenticate, challengeDigest: digest };
}

export interface ClaimsChallenge {
  /** Send with a 401 alongside the problem-details body. */
  wwwAuthenticate: string;
  /** `application/problem+json` body. */
  body: {
    type: 'urn:stripe:link:claims-required';
    aud: string;
    nonce: string;
    claims: string[];
    purpose?: string;
    formats: string[];
    trusted_issuers: string[];
  };
  /** The nonce the application associates with this interaction and later supplies for verification. */
  nonce: string;
  /** Suggested expiry for application enforcement. The SDK does not enforce it. */
  expiresAt: number;
}

export interface CreateClaimsChallengeOptions {
  /** Your own origin. Becomes `aud`, and the KB-JWT must match it exactly. */
  audience: string;
  /** Claim names to request. Must be claims Link advertises. */
  claims: string[];
  /** Why you need them. Shown to the principal; never used in verification. */
  purpose?: string;
  /** Controls the advertised `expiresAt` metadata. Default 300. */
  nonceTtlSeconds?: number;
  /** Injectable for tests. Defaults to 32 random bytes. */
  generateNonce?: () => string;
  now?: () => number;
}

/**
 * Builds the 401 challenge that asks for identity claims on the pre-provisioned
 * lane.
 *
 * The generated nonce is unpredictable. The application must associate it with
 * the interaction and enforce its own expiration and single-use policy. The SDK
 * returns expiration metadata but does not persist or consume nonce state.
 */
export async function createClaimsChallenge(
  issuer: LinkIssuer,
  options: CreateClaimsChallengeOptions,
): Promise<ClaimsChallenge> {
  const supported = await issuer.claimsSupported();
  const unsupported = options.claims.filter((c) => !supported.includes(c));
  if (unsupported.length > 0) {
    throw new Error(
      `${issuer.issuer} does not advertise: ${unsupported.join(', ')}. ` +
        `It supports: ${supported.join(', ')}.`,
    );
  }
  if (options.claims.length === 0) {
    throw new Error('a claims challenge must request at least one claim');
  }

  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const nonce =
    options.generateNonce?.() ??
    toBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const ttl = options.nonceTtlSeconds ?? 300;

  return {
    wwwAuthenticate: 'Identity-Presentation',
    body: {
      type: 'urn:stripe:link:claims-required',
      aud: options.audience,
      nonce,
      claims: options.claims,
      ...(options.purpose ? { purpose: options.purpose } : {}),
      formats: ['dc+sd-jwt'],
      trusted_issuers: [issuer.issuer],
    },
    nonce,
    expiresAt: now + ttl,
  };
}
