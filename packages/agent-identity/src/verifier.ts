/** A configured verifier for Link bearer AATs and identity presentations. */

import {
  type AttestationChallenge,
  type ClaimsChallenge,
  createAttestationChallenge,
  createClaimsChallenge,
} from './challenge.js';
import { verifyClaimsPresentation } from './claims.js';
import { VerificationError, verifyAttestation } from './index.js';
import { type IssuerOptions, LinkIssuer } from './issuer.js';
import type {
  AttestationResult,
  AttestationSuccess,
  ClaimsResult,
  ClaimsSuccess,
} from './types.js';

/**
 * Normalizes the configured claims audience, or undefined if it is not usable.
 *
 * Accepts `host`, `host:port`, or a full origin URL.
 */
function normalizeAudience(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.hostname === '') return undefined;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  // Normalize a trailing dot so equivalent configured hosts share a claims audience.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const isDefault =
    url.port === '' ||
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80');
  const bracketed =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const authority = isDefault ? bracketed : `${bracketed}:${url.port}`;
  return `${url.protocol}//${authority}`;
}

export interface LinkVerifierOptions {
  /**
   * Your service's authority or full HTTP(S) origin, from configuration.
   * A bare authority defaults to HTTPS; explicit schemes are preserved.
   * Sets the audience for identity claims. Bearer AATs have no audience binding.
   */
  origin: string;
  /** Deadline for outbound calls, in milliseconds. Default 3000. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Issuer overrides for staging. Not for trusting another provider. */
  issuerOptions?: Omit<IssuerOptions, 'fetchImpl' | 'now'>;
}

export interface VerifyClaimsInputOptions {
  /** The nonce from the challenge you issued for this interaction. */
  nonce: string;
  /** Claims that must be disclosed. Write [] explicitly to require none. */
  requiredClaims: string[];
}

/** Reuse one instance per process to share issuer keys. */
export class LinkVerifier {
  readonly issuer: LinkIssuer;

  private readonly audience: string;
  private readonly options: LinkVerifierOptions;

  constructor(options: LinkVerifierOptions) {
    if (typeof options.origin !== 'string' || options.origin.trim() === '') {
      throw new Error(
        'LinkVerifier requires an origin for identity claim audiences',
      );
    }
    const normalized = normalizeAudience(options.origin);
    if (normalized === undefined) {
      throw new Error(
        `LinkVerifier origin ${JSON.stringify(options.origin)} is not a usable authority: ` +
          'expected a host, host:port, or origin URL',
      );
    }
    this.options = options;
    this.audience = normalized;
    const now = options.now;
    this.issuer = new LinkIssuer({
      ...(options.issuerOptions ?? {}),
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      ...(now !== undefined ? { now } : {}),
      ...(options.timeoutMs !== undefined
        ? { timeoutMs: options.timeoutMs }
        : {}),
    });
  }

  /** Warms the issuer key cache. Throws if Link is unavailable. */
  async warm(): Promise<void> {
    await this.issuer.refresh({ force: true });
  }

  /** Builds a 401 challenge. Send each value as a separate WWW-Authenticate field. */
  async attestationChallenge(
    options: { maxAgeSeconds?: number } = {},
  ): Promise<AttestationChallenge> {
    return createAttestationChallenge(this.issuer, options);
  }

  /**
   * Verifies the Authorization field's PrivateToken credential.
   * Does not authenticate its presenter or the request carrying it.
   */
  async verifyAttestation(
    authorization: string | null | undefined,
  ): Promise<AttestationResult> {
    return verifyAttestation(authorization, { issuer: this.issuer });
  }

  /** Builds a claims challenge. The application owns nonce state and replay policy. */
  async claimsChallenge(options: {
    claims: string[];
    purpose?: string;
    nonceTtlSeconds?: number;
  }): Promise<ClaimsChallenge> {
    return createClaimsChallenge(this.issuer, {
      audience: this.audienceUrl(),
      claims: options.claims,
      ...(options.purpose !== undefined ? { purpose: options.purpose } : {}),
      ...(options.nonceTtlSeconds !== undefined
        ? { nonceTtlSeconds: options.nonceTtlSeconds }
        : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {}),
    });
  }

  /**
   * Verifies an Identity-Presentation field value, including its holder-signed
   * Key Binding JWT. This binds disclosure to an audience and nonce, not to HTTP
   * method, URL, or body. No Web Bot Auth signature is required or checked.
   */
  async verifyClaims(
    presentation: string | null | undefined,
    options: VerifyClaimsInputOptions,
  ): Promise<ClaimsResult> {
    if (presentation == null || presentation === '') {
      return {
        valid: false,
        failures: [
          {
            code: 'incomplete_protocol_request',
            message: 'no Identity-Presentation credential supplied',
          },
        ],
      };
    }
    if (typeof presentation !== 'string') {
      return {
        valid: false,
        failures: [
          {
            code: 'malformed_protocol_input',
            message: 'Identity-Presentation credential must be a string',
          },
        ],
      };
    }
    return verifyClaimsPresentation({
      presentation,
      audience: this.audienceUrl(),
      nonce: options.nonce,
      requiredClaims: options.requiredClaims,
      issuer: this.issuer,
      ...(this.options.timeoutMs !== undefined
        ? { timeoutMs: this.options.timeoutMs }
        : {}),
      ...(this.options.fetchImpl !== undefined
        ? { fetchImpl: this.options.fetchImpl }
        : {}),
      ...(this.options.now !== undefined ? { now: this.options.now } : {}),
    });
  }

  /** Throws VerificationError on a failed token check. */
  async verifyAttestationOrThrow(
    authorization: string | null | undefined,
  ): Promise<AttestationSuccess> {
    const result = await this.verifyAttestation(authorization);
    if (!result.valid) throw new VerificationError(result.failures);
    return result;
  }

  /** Throws VerificationError on a failed presentation check. */
  async verifyClaimsOrThrow(
    presentation: string | null | undefined,
    options: VerifyClaimsInputOptions,
  ): Promise<ClaimsSuccess> {
    const result = await this.verifyClaims(presentation, options);
    if (!result.valid) throw new VerificationError(result.failures);
    return result;
  }

  /** Claims Link advertises, for validating what you request. */
  async claimsSupported(): Promise<string[]> {
    return this.issuer.claimsSupported();
  }

  private audienceUrl(): string {
    return this.audience;
  }
}
