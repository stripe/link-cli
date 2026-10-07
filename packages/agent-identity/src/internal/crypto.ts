/**
 * WebCrypto wrappers. Everything here is available in Node, Deno, Bun and the
 * major edge runtimes, which is what keeps the verifier deployable at the edge
 * as well as in an origin server.
 */
import { asBufferSource, fromBase64, toBase64url, utf8 } from './bytes.js';
import { parseRsaSpki, wrapRsaEncryptionSpki } from './der.js';

const subtle = globalThis.crypto.subtle;

/**
 * RFC 9578 section 6.4 fixes the signature parameters for token type 0x0002.
 * The salt length equals the hash length, and both are checked against the
 * published key's own declared parameters so a key that would verify under
 * different parameters is refused rather than silently verified under ours.
 */
const REQUIRED_PSS_HASH = 'SHA-384';
const REQUIRED_PSS_SALT_LENGTH = 48;
/** RFC 9578 section 8.2.2 registers the type at a 2048-bit modulus. */
const MIN_MODULUS_BITS = 2048;

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', asBufferSource(data)));
}

export async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-512', asBufferSource(data)));
}

export async function sha384(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-384', asBufferSource(data)));
}

/**
 * Imports a published token key as an RSA-PSS verification key.
 *
 * Privacy Pass token type 0x0002 is RSABSSA-SHA384-PSS-Deterministic. The
 * blinding is entirely client-side: what reaches a verifier is an ordinary
 * RSASSA-PSS signature over the token input, with SHA-384 and a 48-byte salt.
 * So verification needs no blind-signature machinery at all.
 *
 * What it does need is a detour around WebCrypto. RFC 9578 section 6.5 requires
 * the published SPKI to use the `id-RSASSA-PSS` AlgorithmIdentifier with explicit
 * parameters, and WebCrypto accepts only `rsaEncryption`, rejecting the mandated
 * encoding outright. Link publishes the mandated one, so the key is parsed, its
 * declared parameters are checked, and the inner RSAPublicKey is re-wrapped in
 * the envelope WebCrypto will take.
 *
 * Returns a string on failure rather than throwing: this input is a document
 * fetched from a remote issuer, so a key that cannot be used is an operational
 * condition, not a programming error.
 */
export async function importTokenKey(
  spkiDer: Uint8Array,
): Promise<CryptoKey | string> {
  const parsed = parseRsaSpki(spkiDer);
  if (typeof parsed === 'string') return parsed;

  if (parsed.modulusBits < MIN_MODULUS_BITS) {
    return `token key modulus is ${parsed.modulusBits} bits, expected at least ${MIN_MODULUS_BITS}`;
  }

  // When the issuer states its parameters, hold it to them. A key declaring
  // SHA-256 or a zero salt would be verified by this library under SHA-384 with a
  // 48-byte salt, which is a different scheme than the one the issuer published.
  const pss = parsed.pssParams;
  if (pss !== undefined) {
    if (pss.hash !== REQUIRED_PSS_HASH || pss.mgf1Hash !== REQUIRED_PSS_HASH) {
      return `token key declares ${pss.hash}/MGF1-${pss.mgf1Hash}, expected ${REQUIRED_PSS_HASH}`;
    }
    if (pss.saltLength !== REQUIRED_PSS_SALT_LENGTH) {
      return `token key declares a ${pss.saltLength}-byte PSS salt, expected ${REQUIRED_PSS_SALT_LENGTH}`;
    }
  }

  const importable =
    parsed.encoding === 'rsaEncryption'
      ? spkiDer
      : wrapRsaEncryptionSpki(parsed.rsaPublicKey);

  try {
    return await subtle.importKey(
      'spki',
      asBufferSource(importable),
      { name: 'RSA-PSS', hash: REQUIRED_PSS_HASH },
      false,
      ['verify'],
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `token key could not be imported: ${detail}`;
  }
}

/** RSASSA-PSS verify with SHA-384 and a 48-byte salt (saltLength = hLen). */
export async function verifyRsaPss(
  key: CryptoKey,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  return subtle.verify(
    { name: 'RSA-PSS', saltLength: 48 },
    key,
    asBufferSource(signature),
    asBufferSource(message),
  );
}

export interface Jwk {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

/** JOSE algorithms this verifier accepts. `none` is never accepted. */
export type JwsAlg = 'EdDSA' | 'ES256';

export async function importJwkForVerify(
  jwk: Jwk,
  alg: JwsAlg,
): Promise<CryptoKey> {
  if (alg === 'EdDSA') {
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
      throw new Error('EdDSA requires an OKP/Ed25519 key');
    }
    return subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    throw new Error('ES256 requires an EC/P-256 key');
  }
  return subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

export async function verifyJws(
  key: CryptoKey,
  alg: JwsAlg,
  signature: Uint8Array,
  signingInput: Uint8Array,
): Promise<boolean> {
  const params: AlgorithmIdentifier | EcdsaParams =
    alg === 'EdDSA' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' };
  return subtle.verify(
    params,
    key,
    asBufferSource(signature),
    asBufferSource(signingInput),
  );
}

/**
 * RFC 7638 JWK thumbprint (SHA-256, base64url).
 *
 * The required members differ per key type and the lexicographic ordering is
 * part of the definition. RFC 8037 §2 adds `crv`, `kty`, `x` for OKP; those are
 * not in RFC 7638 itself, which only enumerates RSA and EC.
 */
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  let canonical: string;
  switch (jwk.kty) {
    case 'OKP':
      canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
      break;
    case 'EC':
      canonical = JSON.stringify({
        crv: jwk.crv,
        kty: jwk.kty,
        x: jwk.x,
        y: jwk.y,
      });
      break;
    case 'RSA':
      canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
      break;
    default:
      throw new Error(`unsupported kty for thumbprint: ${jwk.kty}`);
  }
  return toBase64url(await sha256(utf8(canonical)));
}

/** JWT headers and payloads must be JSON objects, not null, arrays or primitives. */
export function decodeJwsObject(segment: string): Record<string, unknown> {
  const value: unknown = JSON.parse(
    new TextDecoder().decode(fromBase64(segment)),
  );
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JWT segment must be a JSON object');
  }
  return value as Record<string, unknown>;
}
