/**
 * Just enough DER to read an RSA SubjectPublicKeyInfo and re-wrap it.
 *
 * This exists because of a mismatch between the Privacy Pass key encoding and
 * what WebCrypto accepts. RFC 9578 section 6.5 requires a token key to be published
 * as an SPKI whose AlgorithmIdentifier is `id-RSASSA-PSS`, carrying explicit
 * RSASSA-PSS-params. WebCrypto's `importKey('spki', ..., {name: 'RSA-PSS'})`
 * accepts only the `rsaEncryption` AlgorithmIdentifier and rejects the mandated
 * one with `DataError: Invalid key type`.
 *
 * Both encodings wrap the identical `RSAPublicKey` structure, so the fix is to
 * lift that structure out and re-wrap it in the AlgorithmIdentifier WebCrypto
 * will take. Nothing about the key changes; only the label on the envelope.
 *
 * Deliberately not a general ASN.1 library. It parses exactly the shapes these
 * two encodings produce and refuses everything else, because a permissive parser
 * on untrusted input is a liability and every caller here has one narrow need.
 */

/** 1.2.840.113549.1.1.1 */
const OID_RSA_ENCRYPTION = [
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
];
/** 1.2.840.113549.1.1.10 */
const OID_RSASSA_PSS = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0a];
/** 1.2.840.113549.1.1.8 */
const OID_MGF1 = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x08];

const HASH_OIDS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['SHA-256', [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]],
  ['SHA-384', [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02]],
  ['SHA-512', [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03]],
];

const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_NULL = 0x05;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;

/** Hard ceiling on any parsed structure. A published key is a few hundred bytes. */
const MAX_SPKI_BYTES = 8192;

export type SpkiEncoding = 'id-RSASSA-PSS' | 'rsaEncryption';

export interface PssParams {
  hash: string;
  mgf1Hash: string;
  saltLength: number;
}

export interface ParsedRsaSpki {
  encoding: SpkiEncoding;
  /** The RSAPublicKey DER, i.e. the contents of the SPKI BIT STRING. */
  rsaPublicKey: Uint8Array;
  /** Modulus length in bits, read from the INTEGER. */
  modulusBits: number;
  /** Present only for `id-RSASSA-PSS`, which carries explicit parameters. */
  pssParams?: PssParams | undefined;
}

interface Tlv {
  tag: number;
  contents: Uint8Array;
  /** Offset just past this element in its parent. */
  end: number;
}

class DerError extends Error {}

function fail(message: string): never {
  throw new DerError(message);
}

/** Reads one tag-length-value at `offset`. */
function readTlv(input: Uint8Array, offset: number): Tlv {
  if (offset + 2 > input.length) fail('truncated DER element');
  const tag = input[offset] as number;
  const first = input[offset + 1] as number;
  let length: number;
  let cursor = offset + 2;

  if (first < 0x80) {
    length = first;
  } else {
    const byteCount = first & 0x7f;
    // Indefinite length is BER, not DER, and 4+ length bytes exceeds anything
    // legitimate here.
    if (byteCount === 0 || byteCount > 3)
      fail('unsupported DER length encoding');
    if (cursor + byteCount > input.length) fail('truncated DER length');
    length = 0;
    for (let i = 0; i < byteCount; i++) {
      length = (length << 8) | (input[cursor + i] as number);
    }
    // DER requires the minimal encoding: the long form must be necessary, and its
    // first byte must be non-zero. `0x82 0x00 0x80` encodes 128 in two bytes and
    // would otherwise pass.
    if (input[cursor] === 0) fail('non-minimal DER length');
    cursor += byteCount;
    if (length < 0x80) fail('non-minimal DER length');
  }

  if (length > MAX_SPKI_BYTES) fail('DER element is implausibly large');
  if (cursor + length > input.length)
    fail('DER element runs past the end of input');
  return {
    tag,
    contents: input.subarray(cursor, cursor + length),
    end: cursor + length,
  };
}

function expect(
  input: Uint8Array,
  offset: number,
  tag: number,
  what: string,
): Tlv {
  const tlv = readTlv(input, offset);
  if (tlv.tag !== tag) {
    fail(
      `expected ${what} (tag 0x${tag.toString(16)}), got tag 0x${tlv.tag.toString(16)}`,
    );
  }
  return tlv;
}

function bytesEqual(a: Uint8Array, b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function hashFromOid(oid: Uint8Array): string | undefined {
  for (const [name, bytes] of HASH_OIDS)
    if (bytesEqual(oid, bytes)) return name;
  return undefined;
}

/**
 * Parses an RSA SubjectPublicKeyInfo in either the `rsaEncryption` or the
 * `id-RSASSA-PSS` encoding.
 *
 * Returns a string describing the problem rather than throwing, because the
 * input is a document fetched from a remote issuer and a malformed one is an
 * ordinary outcome rather than a bug.
 */
export function parseRsaSpki(der: Uint8Array): ParsedRsaSpki | string {
  try {
    if (der.length > MAX_SPKI_BYTES) return 'SPKI is implausibly large';

    const outer = expect(der, 0, TAG_SEQUENCE, 'SubjectPublicKeyInfo');
    if (outer.end !== der.length) return 'SPKI has trailing bytes';
    const body = outer.contents;

    const algId = expect(body, 0, TAG_SEQUENCE, 'AlgorithmIdentifier');
    const oid = expect(algId.contents, 0, TAG_OID, 'algorithm OID');

    let encoding: SpkiEncoding;
    let pssParams: PssParams | undefined;
    if (bytesEqual(oid.contents, OID_RSASSA_PSS)) {
      encoding = 'id-RSASSA-PSS';
      const parsed = parsePssParams(algId.contents, oid.end);
      if (typeof parsed === 'string') return parsed;
      pssParams = parsed;
    } else if (bytesEqual(oid.contents, OID_RSA_ENCRYPTION)) {
      encoding = 'rsaEncryption';
      // rsaEncryption requires an explicit NULL parameters field.
      if (oid.end < algId.contents.length) {
        const params = readTlv(algId.contents, oid.end);
        if (params.tag !== TAG_NULL)
          return 'rsaEncryption parameters are not NULL';
      }
    } else {
      return 'SPKI algorithm is neither rsaEncryption nor id-RSASSA-PSS';
    }

    const bitString = expect(
      body,
      algId.end,
      TAG_BIT_STRING,
      'subjectPublicKey',
    );
    if (bitString.end !== body.length)
      return 'SubjectPublicKeyInfo has trailing bytes';
    if (bitString.contents.length < 1) return 'subjectPublicKey is empty';
    if (bitString.contents[0] !== 0) return 'subjectPublicKey has unused bits';
    const rsaPublicKey = bitString.contents.subarray(1);

    // Read the modulus so a caller can enforce a size floor, and so a structure
    // that is not actually an RSAPublicKey is rejected here rather than by
    // WebCrypto with a less useful message.
    const rsaSeq = expect(rsaPublicKey, 0, TAG_SEQUENCE, 'RSAPublicKey');
    const modulus = expect(rsaSeq.contents, 0, TAG_INTEGER, 'RSA modulus');
    // DER signs INTEGERs, so a single leading zero byte is padding for a positive
    // value. More than one is not something DER emits.
    let modulusBytes = modulus.contents;
    if (modulusBytes.length > 1 && modulusBytes[0] === 0) {
      modulusBytes = modulusBytes.subarray(1);
    }
    if (modulusBytes.length === 0 || modulusBytes[0] === 0) {
      return 'RSA modulus is not a minimally-encoded positive integer';
    }

    // Bit length, not byte length times eight: a 2041-bit modulus occupies 256 bytes
    // and would otherwise be reported as 2048 and clear a 2048-bit floor.
    const topByte = modulusBytes[0] as number;
    const modulusBits =
      (modulusBytes.length - 1) * 8 + (32 - Math.clz32(topByte));

    // SEC-7: e must be odd and at least 3. With e = 1, "verification" is the identity
    // and anyone who can encode a PSS block can forge.
    const exponent = expect(
      rsaSeq.contents,
      modulus.end,
      TAG_INTEGER,
      'RSA public exponent',
    );
    let exponentValue = 0;
    for (const byte of exponent.contents)
      exponentValue = exponentValue * 256 + byte;
    if (exponentValue < 3 || exponentValue % 2 === 0) {
      return `RSA public exponent ${exponentValue} is not a valid odd exponent`;
    }

    return {
      encoding,
      rsaPublicKey,
      modulusBits,
      pssParams,
    };
  } catch (error) {
    if (error instanceof DerError) return `malformed SPKI: ${error.message}`;
    throw error;
  }
}

/**
 * RSASSA-PSS-params, per RFC 4055 section 3.1. Every field is DEFAULTed and
 * therefore context-tagged and optional, but RFC 9578 section 6.5 requires
 * hashAlgorithm, maskGenAlgorithm, and saltLength to be present explicitly, so
 * an absent field is a conformance failure rather than a default to apply.
 */
function parsePssParams(
  algIdBody: Uint8Array,
  offset: number,
): PssParams | string {
  if (offset >= algIdBody.length)
    return 'id-RSASSA-PSS key carries no parameters';
  const params = expect(algIdBody, offset, TAG_SEQUENCE, 'RSASSA-PSS-params');

  let hash: string | undefined;
  let mgf1Hash: string | undefined;
  let saltLength: number | undefined;

  let cursor = 0;
  while (cursor < params.contents.length) {
    const field = readTlv(params.contents, cursor);
    cursor = field.end;
    switch (field.tag) {
      case 0xa0: {
        const alg = expect(field.contents, 0, TAG_SEQUENCE, 'hashAlgorithm');
        const oid = expect(alg.contents, 0, TAG_OID, 'hashAlgorithm OID');
        hash = hashFromOid(oid.contents);
        if (hash === undefined) return 'unrecognized PSS hash algorithm';
        break;
      }
      case 0xa1: {
        const alg = expect(field.contents, 0, TAG_SEQUENCE, 'maskGenAlgorithm');
        const oid = expect(alg.contents, 0, TAG_OID, 'maskGenAlgorithm OID');
        if (!bytesEqual(oid.contents, OID_MGF1))
          return 'mask generation function is not MGF1';
        const inner = expect(alg.contents, oid.end, TAG_SEQUENCE, 'MGF1 hash');
        const innerOid = expect(inner.contents, 0, TAG_OID, 'MGF1 hash OID');
        mgf1Hash = hashFromOid(innerOid.contents);
        if (mgf1Hash === undefined) return 'unrecognized MGF1 hash algorithm';
        break;
      }
      case 0xa2: {
        const int = expect(field.contents, 0, TAG_INTEGER, 'saltLength');
        // Salt lengths in use are small; refuse anything that is not one byte.
        if (int.contents.length !== 1) return 'implausible PSS salt length';
        saltLength = int.contents[0] as number;
        break;
      }
      case 0xa3: {
        // RFC 4055 section 3.1: "The value MUST be 1... Other trailer fields are not
        // supported." WebCrypto always uses 0xBC, so accepting any other value would
        // verify a key under a scheme its own SPKI says it does not use, which is the
        // same defect the hash and salt checks exist to prevent.
        const int = expect(field.contents, 0, TAG_INTEGER, 'trailerField');
        if (int.contents.length !== 1 || int.contents[0] !== 1) {
          return 'RSASSA-PSS-params trailerField is not 1';
        }
        break;
      }
      default:
        return `unexpected field in RSASSA-PSS-params (tag 0x${field.tag.toString(16)})`;
    }
  }

  if (hash === undefined) return 'RSASSA-PSS-params omits hashAlgorithm';
  if (mgf1Hash === undefined) return 'RSASSA-PSS-params omits maskGenAlgorithm';
  if (saltLength === undefined) return 'RSASSA-PSS-params omits saltLength';
  return { hash, mgf1Hash, saltLength };
}

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  if (length < 0x100) return new Uint8Array([0x81, length]);
  return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
}

function tlv(tag: number, contents: Uint8Array): Uint8Array {
  const length = encodeLength(contents.length);
  const out = new Uint8Array(1 + length.length + contents.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(contents, 1 + length.length);
  return out;
}

/** `AlgorithmIdentifier { rsaEncryption, NULL }`, which is fixed. */
const RSA_ENCRYPTION_ALG_ID = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
]);

/**
 * `AlgorithmIdentifier { id-RSASSA-PSS, RSASSA-PSS-params }` for
 * SHA-384 / MGF1-SHA-384 / 48-byte salt, which is the only parameter set
 * RFC 9578 section 6.4 permits for token type 0x0002.
 *
 * Fixed bytes rather than an encoder, because there is exactly one legal value
 * and it is verified byte-for-byte against Link's published key in the tests.
 */
const RSASSA_PSS_SHA384_ALG_ID = new Uint8Array([
  0x30, 0x3d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0a,
  0x30, 0x30,
  // [0] hashAlgorithm: sha384
  0xa0, 0x0d, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04,
  0x02, 0x02,
  // [1] maskGenAlgorithm: mgf1 with sha384
  0xa1, 0x1a, 0x30, 0x18, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01,
  0x01, 0x08, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04,
  0x02, 0x02,
  // [2] saltLength: 48
  0xa2, 0x03, 0x02, 0x01, 0x30,
]);

function wrapSpki(algId: Uint8Array, rsaPublicKey: Uint8Array): Uint8Array {
  const bitStringContents = new Uint8Array(1 + rsaPublicKey.length);
  bitStringContents[0] = 0; // no unused bits
  bitStringContents.set(rsaPublicKey, 1);
  const bitString = tlv(TAG_BIT_STRING, bitStringContents);

  const body = new Uint8Array(algId.length + bitString.length);
  body.set(algId, 0);
  body.set(bitString, algId.length);
  return tlv(TAG_SEQUENCE, body);
}

/**
 * Wraps an `RSAPublicKey` in an `rsaEncryption` SubjectPublicKeyInfo, which is
 * the encoding WebCrypto will import.
 */
export function wrapRsaEncryptionSpki(rsaPublicKey: Uint8Array): Uint8Array {
  return wrapSpki(RSA_ENCRYPTION_ALG_ID, rsaPublicKey);
}

/**
 * Wraps an `RSAPublicKey` in the `id-RSASSA-PSS` SubjectPublicKeyInfo that
 * RFC 9578 section 6.5 requires an issuer to publish.
 *
 * The verifier never needs to produce this encoding; the test fixtures do, so
 * that they publish keys in the same form Link does. WebCrypto's `exportKey`
 * emits `rsaEncryption`, which is precisely why a suite built on exported keys
 * cannot detect that the mandated encoding fails to import.
 */
export function wrapRsaSsaPssSpki(rsaPublicKey: Uint8Array): Uint8Array {
  return wrapSpki(RSASSA_PSS_SHA384_ALG_ID, rsaPublicKey);
}
