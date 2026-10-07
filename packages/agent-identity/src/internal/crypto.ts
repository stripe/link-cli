/** Native hashing and RSA verification, with JOSE operations delegated to jose. */
import { constants, createHash, KeyObject, verify } from 'node:crypto';
import { promisify } from 'node:util';
import type { JWK } from 'jose';
import { asBufferSource, fromBase64 } from './bytes.js';
import { parseRsaSpki, wrapRsaEncryptionSpki } from './der.js';

const subtle = globalThis.crypto.subtle;
const verifySignature = promisify(verify);

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
  return new Uint8Array(createHash('sha256').update(data).digest());
}

export async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(createHash('sha512').update(data).digest());
}

export async function sha384(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(createHash('sha384').update(data).digest());
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
  return verifySignature(
    'sha384',
    message,
    {
      key: KeyObject.from(key),
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: REQUIRED_PSS_SALT_LENGTH,
    },
    signature,
  );
}

export interface Jwk extends JWK {
  kty: string;
}

/** JOSE algorithms this verifier accepts. `none` is never accepted. */
export type JwsAlg = 'EdDSA' | 'ES256';

export async function importJwkForVerify(
  jwk: Jwk,
  alg: JwsAlg,
): Promise<CryptoKey> {
  if (alg === 'EdDSA' && (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519')) {
    throw new Error('EdDSA requires an OKP/Ed25519 key');
  }
  if (alg === 'ES256' && (jwk.kty !== 'EC' || jwk.crv !== 'P-256')) {
    throw new Error('ES256 requires an EC/P-256 key');
  }
  if (jwk.d !== undefined)
    throw new Error('verification requires a public JWK');
  // jose's importJWK intentionally ignores alg/use; retain the restrictions
  // enforced by our previous direct WebCrypto import.
  if (
    jwk.alg !== undefined &&
    jwk.alg !== alg &&
    !(alg === 'EdDSA' && jwk.alg === 'Ed25519')
  ) {
    throw new Error('JWK alg does not match the signature algorithm');
  }
  if (jwk.use !== undefined && jwk.use !== 'sig')
    throw new Error('JWK use must be sig');
  if (
    jwk.key_ops !== undefined &&
    (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify'))
  ) {
    throw new Error('JWK key_ops must allow verify');
  }
  // jose v6 is ESM-only. Dynamic imports also work from our CommonJS export on
  // Node 22.0, before require(esm) became available without a flag.
  const { importJWK } = await import('jose');
  const key = await importJWK(jwk, alg, { extractable: false });
  if (key instanceof Uint8Array)
    throw new Error('verification requires an asymmetric key');
  return key;
}

/** Verifies the complete compact JWS, including protected-header semantics. */
export async function verifyJws(
  key: CryptoKey,
  alg: JwsAlg,
  jws: string,
): Promise<boolean> {
  const { compactVerify } = await import('jose');
  try {
    const result = await compactVerify(jws, key, { algorithms: [alg] });
    // JWTs require encoded payloads; the unencoded JWS extension is not supported.
    return result.protectedHeader.b64 !== false;
  } catch {
    return false;
  }
}

/** RFC 7638 public-key thumbprint; jose selects and orders the required members. */
export async function jwkThumbprint(jwk: Jwk): Promise<string> {
  const { calculateJwkThumbprint } = await import('jose');
  return calculateJwkThumbprint(jwk, 'sha256');
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
