/**
 * Verify an SD-JWT-VC the agent already holds, presented with a Key Binding JWT.
 */

import {
  fromBase64,
  quoteForMessage,
  toBase64url,
  utf8,
} from './internal/bytes.js';
import {
  decodeJwsObject,
  importJwkForVerify,
  type Jwk,
  type JwsAlg,
  jwkThumbprint,
  sha256,
  verifyJws,
} from './internal/crypto.js';
import { boundedGet, parseJson } from './internal/http.js';
import { trimTrailingSlashes } from './internal/strings.js';
import type { LinkIssuer } from './issuer.js';
import type { ClaimsResult, Failure } from './types.js';

const KB_JWT_TYP = 'kb+jwt';
/** Bound splitting, JSON parsing, disclosure hashing and signature work. */
const MAX_PRESENTATION_LENGTH = 64 * 1024;

/**
 * Credential media types this verifier accepts in the issuer JWT `typ` header.
 *
 * SD-JWT-VC section 2.2.1 settles on `dc+sd-jwt` and allows `vc+sd-jwt` for a
 * transitional period. Both are listed so a credential minted before the rename
 * still verifies; neither is optional, because the point of the check is to stop
 * an arbitrary JWT from the same keyset being read as a credential.
 */
const ACCEPTED_CREDENTIAL_TYPES = new Set(['dc+sd-jwt', 'vc+sd-jwt']);

/**
 * Names that carry structural meaning in SD-JWT and therefore must never arrive
 * as a disclosed claim name, nor be scanned as an ordinary payload member.
 */
const RESERVED_SD_KEYS = new Set([
  '_sd',
  '_sd_alg',
  '...',
  'iss',
  'exp',
  'nbf',
  'vct',
  'vct#integrity',
  'cnf',
  'status',
  // Security-critical per RFC 9901 section 9.7, and a verifier cannot assume an
  // issuer put it in plaintext, so it must not be arrivable by disclosure either.
  'aud',
]);

/**
 * Structural members that carry no selectively disclosable claims of their own.
 *
 * Deliberately separate from RESERVED_SD_KEYS. The two questions are different:
 * "may this name arrive by disclosure" and "does this member need scanning for
 * hidden disclosures". Sharing one Set made every reserved name a scan blind spot,
 * so a nested `_sd` under `status` or `cnf` was invisible.
 */
const STRUCTURAL_KEYS = new Set([
  '_sd',
  '_sd_alg',
  'iss',
  'exp',
  'nbf',
  'iat',
  'vct',
]);

/**
 * Whether a payload value hides a selectively disclosable member.
 *
 * A nested `_sd` array or an array element shaped `{"...": digest}` means claims
 * exist that this flat profile will not surface. Detecting that is what lets it
 * be refused by name rather than silently dropped.
 */
/** Renders a caught value as a message, so the result union stays total. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  // `String(Object.create(null))` and `String({toString: null})` both throw, out of
  // the one function whose job is to stop anything throwing.
  try {
    return String(error);
  } catch {
    return 'an unprintable value was thrown';
  }
}

function containsNestedDisclosure(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== 'object') return false;
  // Deeper than we will walk. Previously this returned false, which turned the
  // recursion limit into a bypass: a `_sd` array nine objects down was neither
  // processed nor refused. Returning true refuses it instead, which is the correct
  // direction for a structure this profile cannot claim to understand.
  if (depth > MAX_CLAIM_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((item) => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        if ('...' in (item as Record<string, unknown>)) return true;
      }
      return containsNestedDisclosure(item, depth + 1);
    });
  }
  const record = value as Record<string, unknown>;
  if ('_sd' in record || '...' in record) return true;
  return Object.values(record).some((v) =>
    containsNestedDisclosure(v, depth + 1),
  );
}

/**
 * The issuer JWT payload, as parsed from the wire.
 *
 * Every member is `unknown` on purpose. This is attacker-supplied JSON, and some of
 * it is inspected before the issuer signature has been verified, so declaring
 * `iss?: string` was a lie the compiler then helped enforce: `payload.iss?.replace()`
 * type-checked cleanly and threw a TypeError at runtime on a numeric `iss`, which is
 * an unauthenticated crash at a front door. With `unknown`, a missing check is a
 * compile error.
 */
interface IssuerJwtPayload {
  iss?: unknown;
  vct?: unknown;
  exp?: unknown;
  nbf?: unknown;
  aud?: unknown;
  cnf?: { jwk?: Jwk } | unknown;
  _sd?: unknown;
  _sd_alg?: unknown;
  [key: string]: unknown;
}

export interface VerifyClaimsOptions {
  /** The `Identity-Presentation` field value, exactly as received. */
  presentation: string;
  /** The `aud` from the challenge you issued. Compared as an exact string. */
  audience: string;
  /** The `nonce` from the challenge you issued. */
  nonce: string;
  issuer: LinkIssuer;
  /** Claims you asked for. A presentation missing any of them fails. */
  requiredClaims?: string[];
  /** Tolerated `iat` skew in seconds. Default 60. */
  clockSkewSeconds?: number;
  fetchImpl?: typeof fetch;
  /** Deadline for the credential JWKS fetch, in milliseconds. Default 3000. */
  timeoutMs?: number;
  /** Ceiling on the credential JWKS response. Default 256 KiB. */
  maxResponseBytes?: number;
  /** How long a fetched credential JWKS is cached. Default 3600 seconds. */
  jwksTtlSeconds?: number;
  now?: () => number;
}

/**
 * Verifies a presentation.
 *
 * Every check here is load-bearing; the ones most often skipped are recomputing
 * `sd_hash` over the presentation as received, and requiring the KB-JWT at all.
 * Without the first, disclosures can be added or removed after signing. Without
 * the second, the presentation is a bearer credential.
 */
export async function verifyClaimsPresentation(
  options: VerifyClaimsOptions,
): Promise<ClaimsResult> {
  const failures: Failure[] = [];
  const failWith = (code: Failure['code'], message: string): ClaimsResult => {
    failures.push({ code, message });
    return { valid: false, failures };
  };
  const fail = (message: string): ClaimsResult =>
    failWith('invalid_claims_presentation', message);
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const skew = options.clockSkewSeconds ?? 60;

  if (options.presentation.length > MAX_PRESENTATION_LENGTH) {
    return fail('presentation exceeds the 65536-character limit');
  }

  const parts = options.presentation.split('~');
  if (parts.length < 2) {
    return fail('presentation is not a tilde-separated SD-JWT');
  }
  const issuerJwt = parts[0] as string;
  const kbJwt = parts[parts.length - 1] as string;
  const disclosures = parts.slice(1, -1).filter((p) => p.length > 0);

  if (kbJwt === '') {
    // A trailing tilde with nothing after it is a presentation with no key
    // binding. Rejecting it is the point: an unbound presentation is replayable
    // by anyone who observes it.
    return fail('presentation carries no Key Binding JWT');
  }

  // 1. Issuer-signed JWT.
  const issuerSegments = issuerJwt.split('.');
  if (issuerSegments.length !== 3)
    return fail('issuer JWT is not a compact JWS');
  const [issuerHeaderSeg, issuerPayloadSeg, issuerSigSeg] = issuerSegments as [
    string,
    string,
    string,
  ];
  let issuerHeader: Record<string, unknown>;
  let payload: IssuerJwtPayload;
  try {
    issuerHeader = decodeJwsObject(issuerHeaderSeg);
    payload = decodeJwsObject(issuerPayloadSeg);
  } catch {
    return fail('issuer JWT segments must be base64url JSON objects');
  }

  // SD-JWT-VC section 2.2.1 requires `typ`. Checking it prevents a different
  // kind of JWT signed by the same issuer key from being accepted as a
  // credential just because it carries credential-shaped members. The challenge
  // advertises `dc+sd-jwt`, and the verifier checks the returned credential type.
  if (
    typeof issuerHeader.typ !== 'string' ||
    !ACCEPTED_CREDENTIAL_TYPES.has(issuerHeader.typ)
  ) {
    return fail(
      `issuer JWT typ is ${describeHeaderValue(issuerHeader.typ)}, expected one of ${[...ACCEPTED_CREDENTIAL_TYPES].join(', ')}`,
    );
  }

  const issuerAlg = acceptedAlg(issuerHeader.alg);
  if (!issuerAlg) {
    return fail(
      `issuer JWT alg ${describeHeaderValue(issuerHeader.alg)} is not accepted`,
    );
  }

  // Type-checked before use. This runs before the issuer signature is verified, so
  // the payload is entirely attacker-supplied at this point and a non-string `iss`
  // threw a TypeError straight out of the verifier: an unauthenticated crash at the
  // front door from anyone able to send the header.
  if (typeof payload.iss !== 'string') {
    return fail('credential iss is missing or not a string');
  }
  if (typeof payload.vct !== 'string' || payload.vct === '') {
    return fail('credential vct is missing or not a string');
  }
  if (trimTrailingSlashes(payload.iss) !== options.issuer.issuer) {
    return fail(
      `credential issuer ${quoteForMessage(String(payload.iss))} is not ${options.issuer.issuer}`,
    );
  }
  if (!payload.vct) return fail('credential has no vct');

  // Link credential verification requires `exp`. RFC 9901 section 7.1 requires
  // rejecting a credential missing a validity-controlling claim. Without this
  // check, a credential could be presented indefinitely while its signing key
  // remains trusted.
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return fail('credential has no exp');
  }
  // No skew allowance on expiry. The spec says the current time must be before
  // `exp`; granting an extra minute past it is a decision to accept an expired
  // credential, which is not ours to make.
  if (payload.exp <= now) {
    return fail('credential has expired');
  }
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
      return fail('credential nbf is not a number');
    }
    // No skew allowance, for the same reason as `exp`: granting one accepts a
    // credential the issuer says is not yet valid.
    if (payload.nbf > now) {
      return fail('credential is not yet valid');
    }
  }

  // A plaintext `aud` restricts the credential to a different verifier.
  if (payload.aud !== undefined) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(options.audience)) {
      return fail('credential is audience-restricted to a different verifier');
    }
  }

  const cnf = payload.cnf;
  if (cnf === null || typeof cnf !== 'object') {
    return fail('credential has no cnf holder-key confirmation');
  }
  const rawHolderJwk = (cnf as { jwk?: unknown }).jwk;
  if (rawHolderJwk === null || typeof rawHolderJwk !== 'object') {
    return fail('credential has no cnf.jwk holder key');
  }
  if (typeof (rawHolderJwk as { kty?: unknown }).kty !== 'string') {
    return fail('cnf.jwk has no kty');
  }
  const holderJwk = rawHolderJwk as Jwk;

  // Reaches Link's JWKS, so an outage must become a result rather than an
  // exception. A caller cannot distinguish an outage from a bad credential if it
  // arrives as a throw.
  let issuerKeys: CryptoKey[];
  try {
    issuerKeys = await resolveIssuerKeys(
      options,
      typeof issuerHeader.kid === 'string' ? issuerHeader.kid : undefined,
      issuerAlg,
    );
  } catch (error) {
    return failWith('issuer_unavailable', describeError(error));
  }
  if (issuerKeys.length === 0) {
    return failWith(
      'issuer_unavailable',
      'could not resolve a Link credential signing key',
    );
  }
  let issuerSignature: Uint8Array;
  try {
    issuerSignature = fromBase64(issuerSigSeg);
  } catch {
    return fail('issuer JWT signature segment is not valid base64url');
  }
  const signingInput = utf8(`${issuerHeaderSeg}.${issuerPayloadSeg}`);
  let issuerOk = false;
  for (const candidate of issuerKeys) {
    if (await verifyJws(candidate, issuerAlg, issuerSignature, signingInput)) {
      issuerOk = true;
      break;
    }
  }
  if (!issuerOk) return fail('issuer JWT signature does not verify');

  // 2. Disclosures must each be committed to by the issuer.
  // Absent defaults to sha-256 per RFC 9901 section 4.1.1; present but not a string
  // is a rejection rather than a crash.
  const rawSdAlg = payload._sd_alg ?? 'sha-256';
  if (typeof rawSdAlg !== 'string') return fail('_sd_alg is not a string');
  const sdAlg = rawSdAlg.toLowerCase();
  if (sdAlg !== 'sha-256') {
    return fail(
      `unsupported _sd_alg ${quoteForMessage(String(payload._sd_alg))}`,
    );
  }
  // This verifier implements the flat profile Link mints and explicitly refuses
  // anything outside it, rather than implementing RFC 9901 section 7.1 in full.
  // The refusals are deliberate and named: a credential shape this code does not
  // understand must be rejected, not partially processed, because a claim it fails
  // to notice is a claim a merchant acts on without it having been disclosed.
  const rawSd = payload._sd ?? [];
  if (!Array.isArray(rawSd)) return fail('_sd is not an array');

  // RFC 9901 section 7.1 step 4: a digest appearing more than once in the
  // issuer-signed payload is grounds for rejection. Building a Set silently
  // deduped them.
  const committed = new Set<string>();
  for (const digest of rawSd) {
    if (typeof digest !== 'string')
      return fail('_sd contains a non-string digest');
    if (committed.has(digest)) {
      return fail('the credential commits to the same digest more than once');
    }
    committed.add(digest);
  }

  // Nested selective disclosure is outside this profile. Refused rather than
  // ignored, because ignoring it means silently dropping claims the holder
  // believes they disclosed.
  for (const [name, value] of Object.entries(payload)) {
    if (STRUCTURAL_KEYS.has(name)) continue;
    if (containsNestedDisclosure(value)) {
      return fail(
        `claim ${quoteForMessage(name)} uses nested selective disclosure, which this profile does not support`,
      );
    }
  }

  const claims: Record<string, unknown> = {};
  for (const disclosure of disclosures) {
    const digest = toBase64url(await sha256(utf8(disclosure)));
    if (!committed.has(digest)) {
      return fail('a disclosure is not committed to by the credential');
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder().decode(fromBase64(disclosure)));
    } catch {
      return fail('a disclosure is not valid base64url JSON');
    }
    if (!Array.isArray(decoded)) {
      return fail('a disclosure is not a JSON array');
    }
    if (decoded.length === 2) {
      // A two-element disclosure is an array-element disclosure. Outside this
      // profile, and named so it is not mistaken for a malformed triple.
      return fail(
        'array-element disclosure is not supported by this profile; expected [salt, name, value]',
      );
    }
    if (decoded.length !== 3) {
      return fail('a disclosure is not a [salt, name, value] triple');
    }
    if (typeof decoded[1] !== 'string') {
      return fail('a disclosure claim name is not a string');
    }
    const name = decoded[1];

    // RFC 9901 section 7.1 step 3.c.ii.2: these names must never arrive by
    // disclosure, or a disclosure could forge the commitment structure itself.
    if (RESERVED_SD_KEYS.has(name)) {
      return fail(
        `a disclosure uses the reserved claim name ${quoteForMessage(name)}`,
      );
    }
    // Step 3.c.ii.3: a disclosure must not collide with a claim the issuer put in
    // the payload in the clear.
    if (Object.hasOwn(payload, name)) {
      return fail(
        `disclosed claim ${quoteForMessage(name)} collides with a plaintext claim in the credential`,
      );
    }
    if (Object.hasOwn(claims, name)) {
      return fail(`claim ${quoteForMessage(name)} was disclosed twice`);
    }
    // A disclosed value can itself carry `_sd` or an `{"...": digest}` array element
    // (RFC 9901 section 4.2.6). This profile does not resolve those, so handing the
    // raw structure to the merchant would present undisclosed placeholders as
    // disclosed data.
    if (containsNestedDisclosure(decoded[2])) {
      return fail(
        `disclosed claim ${quoteForMessage(name)} carries nested selective disclosure, which this profile does not support`,
      );
    }
    // Treat all disclosed names as data, including JavaScript's __proto__ name.
    Object.defineProperty(claims, name, {
      value: decoded[2],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  // 3. Key Binding JWT.
  const kbSegments = kbJwt.split('.');
  if (kbSegments.length !== 3) return fail('KB-JWT is not a compact JWS');
  const [kbHeaderSeg, kbPayloadSeg, kbSigSeg] = kbSegments as [
    string,
    string,
    string,
  ];
  let kbHeader: Record<string, unknown>;
  let kbPayload: Record<string, unknown>;
  try {
    kbHeader = decodeJwsObject(kbHeaderSeg);
    kbPayload = decodeJwsObject(kbPayloadSeg);
  } catch {
    return fail('KB-JWT segments must be base64url JSON objects');
  }

  if (kbHeader.typ !== KB_JWT_TYP) {
    return fail(
      `KB-JWT typ is ${describeHeaderValue(kbHeader.typ)}, expected "${KB_JWT_TYP}"`,
    );
  }
  const kbAlg = acceptedAlg(kbHeader.alg);
  if (!kbAlg) {
    return fail(
      `KB-JWT alg ${describeHeaderValue(kbHeader.alg)} is not accepted`,
    );
  }

  if (kbPayload.aud !== options.audience) {
    return fail('KB-JWT aud does not match this verifier');
  }
  if (kbPayload.nonce !== options.nonce) {
    return fail('KB-JWT nonce does not match the challenge');
  }
  if (typeof kbPayload.iat !== 'number' || !Number.isFinite(kbPayload.iat))
    return fail('KB-JWT iat is missing or not a finite number');
  if (Math.abs(now - kbPayload.iat) > skew) {
    return fail('KB-JWT iat is outside the accepted window');
  }

  // sd_hash covers the presentation as received, up to and including the final
  // tilde before the KB-JWT. Recomputing it is what stops a disclosure being
  // added or dropped after the holder signed.
  // Taken from the presentation as received rather than reassembled from the
  // parsed parts. Rebuilding it normalizes away anything the parser dropped, such
  // as an injected empty tilde segment, so the binding would not be byte-exact.
  const sdPart = options.presentation.slice(
    0,
    options.presentation.lastIndexOf('~') + 1,
  );
  const expectedSdHash = toBase64url(await sha256(utf8(sdPart)));
  if (kbPayload.sd_hash !== expectedSdHash) {
    return fail('KB-JWT sd_hash does not match the presentation as received');
  }

  let holderKey: CryptoKey;
  try {
    holderKey = await importJwkForVerify(holderJwk, kbAlg);
  } catch (error) {
    return fail(`cnf.jwk could not be imported: ${(error as Error).message}`);
  }
  let kbSignature: Uint8Array;
  try {
    kbSignature = fromBase64(kbSigSeg);
  } catch {
    return fail('KB-JWT signature segment is not valid base64url');
  }
  const kbOk = await verifyJws(
    holderKey,
    kbAlg,
    kbSignature,
    utf8(`${kbHeaderSeg}.${kbPayloadSeg}`),
  );
  if (!kbOk) return fail('KB-JWT signature does not verify under cnf.jwk');

  // 4. Everything asked for was actually disclosed.
  if (options.requiredClaims === undefined) {
    return fail(
      'requiredClaims must be supplied, even as an empty array: a presentation disclosing nothing is otherwise valid',
    );
  }
  const missing = options.requiredClaims.filter(
    (c) => !Object.hasOwn(claims, c),
  );
  if (missing.length > 0) {
    return fail(
      `presentation does not disclose: ${missing.map((c) => quoteForMessage(c)).join(', ')}`,
    );
  }

  return {
    valid: true,
    issuer: options.issuer.issuer,
    vct: payload.vct,
    claims,
    holderKeyThumbprint: await jwkThumbprint(holderJwk),
  };
}

// Avoid invoking attacker-supplied toString properties while reporting bad fields.
function describeHeaderValue(value: unknown): string {
  return typeof value === 'string' || value === undefined
    ? quoteForMessage(String(value))
    : 'not a string';
}

function acceptedAlg(alg: unknown): JwsAlg | undefined {
  if (alg === 'EdDSA') return 'EdDSA';
  if (alg === 'ES256') return 'ES256';
  // `none` and everything else is refused rather than defaulted.
  return undefined;
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

/** Keys considered from one credential JWKS. Bounds per-request import work. */
const MAX_CREDENTIAL_KEYS = 16;

/** How deep a payload value is inspected before it is refused as un-inspectable. */
const MAX_CLAIM_DEPTH = 8;

/**
 * Every trusted credential signing key that could verify this algorithm.
 *
 * Returns all candidates rather than the first importable one. `importJwkForVerify`
 * only fails on a wrong key type, so returning the first meant that with two
 * Ed25519 keys in the JWKS and no matching `kid`, roughly half of credentials were
 * checked against the wrong key and failed as "signature does not verify". That
 * breaks credential key rotation, which is the situation a JWKS exists for.
 */
async function resolveIssuerKeys(
  options: VerifyClaimsOptions,
  kid: string | undefined,
  alg: JwsAlg,
): Promise<CryptoKey[]> {
  const metadata = await options.issuer.getMetadata();
  const uri = metadata.claims_jwks_uri;
  if (!uri) return [];

  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const cached = jwksCache.get(uri);
  let keys =
    cached && now - cached.fetchedAt < (options.jwksTtlSeconds ?? 3600)
      ? cached.keys
      : undefined;
  if (!keys) {
    // Routed through boundedGet like every other outbound call. This one was
    // missed: it is the claims lane's trust anchor, and it had no deadline, no
    // byte ceiling, no redirect policy, and no same-origin check, so a slow
    // credential JWKS hung every concurrent claims verification indefinitely even
    // with a timeout configured on the issuer.
    const result = await boundedGet(uri, {
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      timeoutMs: options.timeoutMs ?? 3000,
      maxBytes: options.maxResponseBytes ?? 256 * 1024,
      requireOrigin: new URL(options.issuer.issuer).origin,
    });
    if (!result.ok) {
      // Thrown rather than returned so the caller maps it to issuer_unavailable
      // alongside every other way this lane can fail to reach Link.
      throw new Error(`credential JWKS: ${result.reason}`);
    }
    const body = parseJson(result.text);
    if (typeof body === 'string') throw new Error(`credential JWKS: ${body}`);
    if (body === null || typeof body !== 'object') {
      throw new Error('credential JWKS is not a JSON object');
    }
    const raw = (body as { keys?: unknown }).keys;
    keys = Array.isArray(raw)
      ? raw
          .filter((k): k is Jwk => k !== null && typeof k === 'object')
          .slice(0, MAX_CREDENTIAL_KEYS)
      : [];
    jwksCache.set(uri, { keys, fetchedAt: now });
  }

  const candidates = kid ? keys.filter((k) => k.kid === kid) : keys;
  const considered = (candidates.length > 0 ? candidates : keys).slice(
    0,
    MAX_CREDENTIAL_KEYS,
  );
  const imported: CryptoKey[] = [];
  for (const jwk of considered) {
    try {
      imported.push(await importJwkForVerify(jwk, alg));
    } catch {
      // Wrong key type for this alg. Try the next.
    }
  }
  return imported;
}

/** Test seam: clears the JWKS cache. */
export function clearJwksCache(): void {
  jwksCache.clear();
}
