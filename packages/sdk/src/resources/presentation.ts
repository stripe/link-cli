/**
 * Holder-side identity presentations for Link's SD-JWT-VC profile.
 *
 * Runtime-neutral: uses only Web Crypto, TextEncoder, and TextDecoder, so it
 * runs in Node.js, browsers, and edge runtimes such as Cloudflare Workers.
 */
import { z } from 'zod';
// Relative paths, unlike the `@/` alias, stay resolvable in emitted declarations.
import { LinkConfigurationError, LinkSdkError } from '../errors';
import { decodeBase64url, encodeBase64url } from './base64url';
import { parseHolderPublicJwk } from './holder-jwk-parse';
import type { HolderPublicJwk } from './interfaces';

export type LinkPresentationErrorCode =
  | 'invalid_credential'
  | 'invalid_issuer_jwt'
  | 'invalid_base64url_json'
  | 'unsupported_profile'
  | 'credential_expired'
  | 'credential_not_yet_valid'
  | 'audience_restricted'
  | 'duplicate_commitments'
  | 'nested_disclosure'
  | 'invalid_disclosure'
  | 'reserved_or_duplicate_claim'
  | 'claim_unavailable'
  | 'invalid_holder_key'
  | 'holder_key_mismatch';

/**
 * A credential or holder key that cannot produce a presentation.
 *
 * Messages never quote credential content, which carries personal data.
 */
export class LinkPresentationError extends LinkSdkError {
  declare readonly code: LinkPresentationErrorCode;
  /** The requested claim name, for `claim_unavailable`. */
  readonly claim?: string;

  constructor(
    code: LinkPresentationErrorCode,
    message: string,
    options?: { claim?: string; cause?: unknown },
  ) {
    super(message, { code, cause: options?.cause });
    if (options?.claim !== undefined) this.claim = options.claim;
  }
}

/** An Ed25519 private key, as a CryptoKey or a private OKP JWK (`x` and `d`). */
export type PresentationHolderKey = CryptoKey | JsonWebKey;

export interface CreatePresentationOptions {
  /** The SD-JWT credential Link issued, ending in `~`, without a KB-JWT. */
  credential: string;
  /**
   * The holder private key bound by the credential's `cnf.jwk`. A function is
   * called only after the credential and requested claims are validated, so
   * key material need not be loaded for a presentation that cannot succeed.
   * Errors it throws propagate unchanged.
   */
  holderKey:
    | PresentationHolderKey
    | (() => PresentationHolderKey | Promise<PresentationHolderKey>);
  /** The exact `aud` from the verifier's challenge. */
  aud: string;
  /** The `nonce` from the verifier's challenge. */
  nonce: string;
  /** Top-level claims to disclose, in order. Duplicates are ignored. */
  disclose: string[];
  /** Current time in Unix seconds. Defaults to the system clock. */
  now?: () => number;
}

// Link's flat SD-JWT profile. Unknown plaintext claims cannot be hidden when
// forwarding the issuer JWT, so reject them rather than disclose them silently.
const payloadSchema = z
  .object({
    iss: z.literal('https://api.link.com'),
    vct: z.string().min(1),
    exp: z.number().int(),
    iat: z.number().int().optional(),
    nbf: z.number().int().optional(),
    aud: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
    cnf: z.object({ jwk: z.unknown() }).strict(),
    _sd: z.array(z.string()).default([]),
    _sd_alg: z.literal('sha-256').default('sha-256'),
    status: z.unknown().optional(),
    'vct#integrity': z.string().optional(),
  })
  .strict();

const headerSchema = z.object({ typ: z.enum(['dc+sd-jwt', 'vc+sd-jwt']) });

const disclosureSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.unknown(),
]);

const KB_HEADER = { typ: 'kb+jwt', alg: 'EdDSA' };
const ED25519 = { name: 'Ed25519' };
const encoder = new TextEncoder();
// Keep a UTF-8 BOM so a BOM-prefixed segment fails JSON parsing.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

function fail(code: LinkPresentationErrorCode, message: string): never {
  throw new LinkPresentationError(code, message);
}

function decodeJson(segment: string): unknown {
  const bytes = segment ? decodeBase64url(segment) : undefined;
  try {
    if (!bytes) throw new Error();
    return JSON.parse(decoder.decode(bytes));
  } catch {
    // JSON parse errors may quote personal information from the credential.
    return fail(
      'invalid_base64url_json',
      'Credential contains invalid base64url JSON.',
    );
  }
}

function encodeJson(value: unknown): string {
  return encodeBase64url(encoder.encode(JSON.stringify(value)));
}

async function digest(value: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest(
    'SHA-256',
    encoder.encode(value),
  );
  return encodeBase64url(new Uint8Array(hash));
}

function hasNestedDisclosure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, '_sd') || Object.hasOwn(value, '...')) return true;
  return Object.values(value).some(hasNestedDisclosure);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateOptions(options: CreatePresentationOptions): void {
  if (!isNonEmptyString(options.aud)) {
    throw new LinkConfigurationError('aud must be a non-empty string');
  }
  if (!isNonEmptyString(options.nonce)) {
    throw new LinkConfigurationError('nonce must be a non-empty string');
  }
  if (
    !Array.isArray(options.disclose) ||
    options.disclose.length === 0 ||
    !options.disclose.every(isNonEmptyString)
  ) {
    throw new LinkConfigurationError(
      'disclose must be a non-empty array of claim names',
    );
  }
}

interface ValidatedCredential {
  /** Issuer JWT and selected disclosures ending in `~`: what `sd_hash` covers. */
  sdPart: string;
  holderJwk: HolderPublicJwk;
}

async function selectDisclosures(
  credential: string,
  aud: string,
  disclose: string[],
  now: number,
): Promise<ValidatedCredential> {
  if (typeof credential !== 'string') {
    fail('invalid_credential', 'Credential must be a string.');
  }
  const [issuerJwt, ...disclosures] = credential.split('~');
  if (!issuerJwt || disclosures.pop() !== '') {
    fail(
      'invalid_credential',
      'Credential must be an SD-JWT without a Key Binding JWT.',
    );
  }
  const segments = issuerJwt.split('.');
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    fail('invalid_issuer_jwt', 'Credential has an invalid issuer JWT.');
  }
  const header = headerSchema.safeParse(decodeJson(segments[0] as string));
  const parsed = payloadSchema.safeParse(decodeJson(segments[1] as string));
  if (!header.success || !parsed.success) {
    fail(
      'unsupported_profile',
      'Credential does not use the supported Link SD-JWT profile (flat disclosures, SHA-256, no plaintext user claims).',
    );
  }
  const payload = parsed.data;
  if (payload.exp <= now) {
    fail('credential_expired', 'Credential has expired.');
  }
  if (payload.nbf !== undefined && payload.nbf > now) {
    fail('credential_not_yet_valid', 'Credential is not yet valid.');
  }
  if (
    payload.aud !== undefined &&
    !(Array.isArray(payload.aud) ? payload.aud : [payload.aud]).includes(aud)
  ) {
    fail(
      'audience_restricted',
      'Credential is restricted to a different audience.',
    );
  }
  const committed = new Set(payload._sd);
  if (committed.size !== payload._sd.length) {
    fail(
      'duplicate_commitments',
      'Credential contains duplicate disclosure commitments.',
    );
  }
  for (const [name, value] of Object.entries(payload)) {
    if (name !== '_sd' && hasNestedDisclosure(value)) {
      fail(
        'nested_disclosure',
        'Nested selective disclosure is not supported.',
      );
    }
  }

  const available = new Map<string, string>();
  for (const disclosure of disclosures) {
    const decoded = disclosureSchema.safeParse(decodeJson(disclosure));
    if (!decoded.success || !committed.has(await digest(disclosure))) {
      fail(
        'invalid_disclosure',
        'Credential contains an invalid or uncommitted disclosure.',
      );
    }
    const [, name, value] = decoded.data;
    if (
      name === '...' ||
      Object.hasOwn(payloadSchema.shape, name) ||
      available.has(name)
    ) {
      fail(
        'reserved_or_duplicate_claim',
        'Credential contains a reserved or duplicate disclosure claim.',
      );
    }
    if (hasNestedDisclosure(value)) {
      fail(
        'nested_disclosure',
        'Nested selective disclosure is not supported.',
      );
    }
    available.set(name, disclosure);
  }
  const selected = [...new Set(disclose)].map((name) => {
    const disclosure = available.get(name);
    if (!disclosure) {
      throw new LinkPresentationError(
        'claim_unavailable',
        `Requested claim is not available for selective disclosure: ${name}`,
        { claim: name },
      );
    }
    return disclosure;
  });

  let holderJwk: HolderPublicJwk;
  try {
    holderJwk = parseHolderPublicJwk(payload.cnf.jwk);
  } catch (error) {
    throw new LinkPresentationError(
      'unsupported_profile',
      'Credential cnf.jwk is not a supported Ed25519 holder key.',
      { cause: error },
    );
  }

  // Keep the issuer JWT and encoded disclosures byte-for-byte. RFC 9901 hashes
  // the selected SD-JWT including the final tilde immediately before the KB-JWT.
  return { sdPart: `${[issuerJwt, ...selected].join('~')}~`, holderJwk };
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof globalThis.CryptoKey === 'function' &&
    value instanceof globalThis.CryptoKey
  );
}

/**
 * Imports the holder signing key. Returns the JWK's public member when one is
 * available, so an obvious mismatch fails before signing.
 */
async function importHolderKey(
  key: unknown,
): Promise<{ signingKey: CryptoKey; publicJwk?: HolderPublicJwk }> {
  if (isCryptoKey(key)) {
    if (
      key.type !== 'private' ||
      key.algorithm.name !== 'Ed25519' ||
      !key.usages.includes('sign')
    ) {
      fail(
        'invalid_holder_key',
        'Holder key must be an Ed25519 private CryptoKey with sign usage.',
      );
    }
    return { signingKey: key };
  }

  const invalidJwk =
    'Holder key must be a private Ed25519 OKP JWK with x and d.';
  let publicJwk: HolderPublicJwk;
  try {
    publicJwk = parseHolderPublicJwk(key);
  } catch (error) {
    throw new LinkPresentationError('invalid_holder_key', invalidJwk, {
      cause: error,
    });
  }
  const d = (key as JsonWebKey).d;
  if (!isNonEmptyString(d)) fail('invalid_holder_key', invalidJwk);
  try {
    const signingKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      { ...publicJwk, d },
      ED25519,
      false,
      ['sign'],
    );
    return { signingKey, publicJwk };
  } catch (error) {
    throw new LinkPresentationError(
      'invalid_holder_key',
      'Holder key JWK could not be imported.',
      { cause: error },
    );
  }
}

async function verifiesUnder(
  holderJwk: HolderPublicJwk,
  signature: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  try {
    const publicKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      holderJwk,
      ED25519,
      false,
      ['verify'],
    );
    return await globalThis.crypto.subtle.verify(
      ED25519,
      publicKey,
      signature,
      data,
    );
  } catch {
    return false;
  }
}

/**
 * Builds an identity presentation answering a verifier's claims challenge.
 *
 * Validates the credential against Link's flat SD-JWT profile, selects the
 * requested disclosures, and appends a Key Binding JWT signed by the holder key
 * over `aud`, `nonce`, `iat`, and `sd_hash`. Returns the value to send as the
 * `Identity-Presentation` field.
 *
 * The holder key is checked against `cnf.jwk` by verifying the new signature
 * under `cnf.jwk`, so non-extractable CryptoKeys work without exporting them.
 *
 * @throws LinkConfigurationError when `aud`, `nonce`, or `disclose` is invalid.
 * @throws LinkPresentationError when the credential or holder key cannot be used.
 */
export async function createPresentation(
  options: CreatePresentationOptions,
): Promise<string> {
  validateOptions(options);
  const now = Math.floor(options.now ? options.now() : Date.now() / 1000);
  if (!Number.isFinite(now)) {
    throw new LinkConfigurationError('now must return Unix seconds');
  }
  const { sdPart, holderJwk } = await selectDisclosures(
    options.credential,
    options.aud,
    options.disclose,
    now,
  );

  const key =
    typeof options.holderKey === 'function'
      ? await options.holderKey()
      : options.holderKey;
  const { signingKey, publicJwk } = await importHolderKey(key);
  const mismatch = 'Holder key does not match the credential cnf.jwk.';
  if (publicJwk && publicJwk.x !== holderJwk.x) {
    fail('holder_key_mismatch', mismatch);
  }

  const kbInput = `${encodeJson(KB_HEADER)}.${encodeJson({
    aud: options.aud,
    nonce: options.nonce,
    iat: now,
    sd_hash: await digest(sdPart),
  })}`;
  const data = encoder.encode(kbInput);
  const signature = new Uint8Array(
    await globalThis.crypto.subtle.sign(ED25519, signingKey, data),
  );
  if (!(await verifiesUnder(holderJwk, signature, data))) {
    fail('holder_key_mismatch', mismatch);
  }
  return `${sdPart}${kbInput}.${encodeBase64url(signature)}`;
}
