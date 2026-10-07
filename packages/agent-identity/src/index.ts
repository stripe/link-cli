/**
 * agent-identity
 *
 * Verify Link-issued Agent Attestation Tokens and Link identity claims at your
 * front door, offline, against Link's published keys.
 *
 * Link is the only trusted issuer. Identity claims are verified through
 * holder-bound SD-JWT-VC presentations. The SDK does not provide risk scoring.
 */

export type { ParsedToken } from './attestation.js';
export {
  challengeDigestMatches,
  encodeTokenChallenge,
  parsePrivateTokenCredential,
  parseToken,
  verifyTokenSignature,
} from './attestation.js';
export type {
  AttestationChallenge,
  ClaimsChallenge,
  CreateAttestationChallengeOptions,
  CreateClaimsChallengeOptions,
} from './challenge.js';

export {
  createAttestationChallenge,
  createClaimsChallenge,
} from './challenge.js';
export type { VerifyClaimsOptions } from './claims.js';

export {
  clearJwksCache,
  verifyClaimsPresentation,
} from './claims.js';
export type { IssuerOptions, ResolvedTokenKey } from './issuer.js';
export { LINK_ISSUER, LinkIssuer, TOKEN_TYPE_BLIND_RSA } from './issuer.js';
export type {
  AttestationFailure,
  AttestationResult,
  AttestationSuccess,
  ClaimsFailure,
  ClaimsResult,
  ClaimsSuccess,
  Failure,
  FailureCode,
} from './types.js';
export type {
  LinkVerifierOptions,
  VerifyClaimsInputOptions,
} from './verifier.js';
export { LinkVerifier } from './verifier.js';

import {
  challengeDigestMatches,
  parsePrivateTokenCredential,
  parseToken,
  verifyTokenSignature,
} from './attestation.js';
import {
  type VerifyClaimsOptions,
  verifyClaimsPresentation,
} from './claims.js';
import { quoteForMessage } from './internal/bytes.js';
import type { LinkIssuer } from './issuer.js';
import type {
  AttestationResult,
  AttestationSuccess,
  ClaimsSuccess,
  Failure,
  FailureCode,
} from './types.js';

/**
 * Renders a caught value as a message.
 *
 * Named `describe` deliberately narrowly: it exists so a thrown value from an
 * extension point becomes a `Failure` rather than propagating, which is what makes
 * the result union total.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  // `String(Object.create(null))` and `String({toString: null})` both throw, out of
  // the one function whose job is to stop anything throwing.
  try {
    return String(error);
  } catch {
    return 'an unprintable value was thrown';
  }
}

export interface VerifyAttestationOptions {
  issuer: LinkIssuer;
}

const ATTESTATION_RECOVERY_GUIDANCE =
  'Use the Link Agent Wallet (https://github.com/stripe/link-cli) to obtain a Link bearer ' +
  'Agent Attestation Token (AAT), then retry with Authorization: PrivateToken token="...".';

/**
 * Verifies a Link bearer AAT from an Authorization field value.
 *
 * Checks token structure, issuer trust, the stable bearer challenge, and the
 * blind-RSA authenticator. Does not authenticate the HTTP request, establish
 * possession of an agent key, or enforce single use. The caller must protect
 * credentials in transit and apply its own authorization and replay policy.
 */
export async function verifyAttestation(
  authorization: string | null | undefined,
  options: VerifyAttestationOptions,
): Promise<AttestationResult> {
  const fail = (code: Failure['code'], message: string): AttestationResult => ({
    valid: false,
    failures: [
      {
        code,
        message: isRejection({ code, message })
          ? `${message}. ${ATTESTATION_RECOVERY_GUIDANCE}`
          : message,
      },
    ],
  });

  if (authorization == null || authorization === '') {
    return fail(
      'incomplete_protocol_request',
      'no Authorization credential supplied',
    );
  }
  if (typeof authorization !== 'string') {
    return fail(
      'malformed_protocol_input',
      'Authorization credential must be a string',
    );
  }
  const tokenBytes = parsePrivateTokenCredential(authorization);
  if (typeof tokenBytes === 'string') {
    return fail('malformed_protocol_input', tokenBytes);
  }
  const token = parseToken(tokenBytes);
  if (typeof token === 'string') {
    return fail('malformed_protocol_input', token);
  }

  let issuerKey: Awaited<ReturnType<LinkIssuer['resolveKey']>>;
  try {
    issuerKey = await options.issuer.resolveKey(token.tokenKeyId);
  } catch (error) {
    return fail('issuer_unavailable', describe(error));
  }
  if (!issuerKey) {
    const refused = options.issuer.explainUnresolved(token.tokenKeyId);
    return fail(
      'unknown_issuer',
      refused !== undefined
        ? `token_key_id resolves to a key published by ${options.issuer.issuer} that this verifier will not accept: ${quoteForMessage(refused)}`
        : `token_key_id does not resolve to a key published by ${options.issuer.issuer}`,
    );
  }

  const match = await challengeDigestMatches({
    issuerName: options.issuer.issuerName,
    presented: token.challengeDigest,
  });
  if (!match.matched) {
    return fail(
      'challenge_mismatch',
      'token does not match the stable Link bearer challenge; key-bound tokens are not supported',
    );
  }

  if (!(await verifyTokenSignature(token, issuerKey))) {
    return fail('invalid_private_token', 'token authenticator does not verify');
  }

  return {
    valid: true,
    issuer: options.issuer.issuer,
    tokenKeyId: token.tokenKeyId,
    bindingMode: 'bearer',
  };
}

/**
 * Thrown by the `*OrThrow` variants.
 *
 * Carries the same `Failure` list the union-returning variants produce, so the
 * failure vocabulary is identical whichever shape a caller uses.
 */
export class VerificationError extends Error {
  readonly failures: readonly Failure[];
  /** The decisive failure code, for branching. */
  readonly code: Failure['code'];

  constructor(failures: readonly Failure[]) {
    const first = failures[0];
    super(first?.message ?? 'verification failed');
    this.name = 'VerificationError';
    this.failures = failures;
    this.code = first?.code ?? 'malformed_protocol_input';
  }
}

/**
 * `verifyAttestation`, but throws on failure instead of returning a union.
 *
 * The union is the right default for this domain, because a bad credential at a
 * front door is an expected outcome rather than an exception. But TypeScript has
 * no way to insist a result is inspected, and the failure object is truthy, so
 * `if (!await verifyAttestation(...)) deny()` compiles and admits every request.
 * This variant fails closed for callers who would rather not have that available.
 *
 * It is also the contract other-language ports implement: Go, Ruby, and Python
 * SDKs will be exception-shaped or `(value, error)`-shaped whatever this library
 * does, and shipping both shapes means every SDK agrees on the `FailureCode`
 * vocabulary even where the control flow differs.
 */
export async function verifyAttestationOrThrow(
  authorization: string | null | undefined,
  options: VerifyAttestationOptions,
): Promise<AttestationSuccess> {
  const result = await verifyAttestation(authorization, options);
  if (!result.valid) throw new VerificationError(result.failures);
  return result;
}

/** `verifyClaimsPresentation`, but throws on failure. See `verifyAttestationOrThrow`. */
export async function verifyClaimsPresentationOrThrow(
  options: VerifyClaimsOptions,
): Promise<ClaimsSuccess> {
  const result = await verifyClaimsPresentation(options);
  if (!result.valid) throw new VerificationError(result.failures);
  return result;
}

/**
 * Every failure code, as a runtime value.
 *
 * `FailureCode` is a closed union so an exhaustive switch is checkable, and this
 * is the list to check a code against at runtime, for example when deciding
 * whether an unrecognized code from a newer version should be treated as a
 * rejection.
 */
const ALL_FAILURE_CODES: Record<FailureCode, true> = {
  incomplete_protocol_request: true,
  malformed_protocol_input: true,
  invalid_private_token: true,
  challenge_mismatch: true,
  unknown_issuer: true,
  invalid_claims_presentation: true,
  issuer_unavailable: true,
};

export const FAILURE_CODES = [
  'incomplete_protocol_request',
  'malformed_protocol_input',
  'invalid_private_token',
  'challenge_mismatch',
  'unknown_issuer',
  'invalid_claims_presentation',
  'issuer_unavailable',
] as const satisfies readonly FailureCode[];

// `satisfies readonly FailureCode[]` only checks that each element IS a code, so
// adding one to the union and forgetting the array would compile silently and
// quietly break `isRejection` for it. The keyed record above is exhaustive in the
// other direction, and this asserts the two agree.
const _failureCodesAreExhaustive: readonly FailureCode[] = Object.keys(
  ALL_FAILURE_CODES,
) as FailureCode[];
if (_failureCodesAreExhaustive.length !== FAILURE_CODES.length) {
  throw new Error(
    'FAILURE_CODES is out of sync with the FailureCode union; add the missing code to both',
  );
}

/**
 * Codes that mean "this credential is bad" rather than "I could not tell".
 *
 * The distinction is the difference between answering 401 and answering 503, and
 * getting it wrong in either direction is a real incident: 401 on a Link outage
 * locks out every legitimate agent, and 503 on a forged token tells an attacker to
 * retry.
 */
export const REJECTION_CODES = FAILURE_CODES.filter(
  (code) => code !== 'issuer_unavailable',
);

/** Whether this failure means the credential was bad, as opposed to unavailable. */
export function isRejection(failure: Failure): boolean {
  return (REJECTION_CODES as readonly string[]).includes(failure.code);
}
