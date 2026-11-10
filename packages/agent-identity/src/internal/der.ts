/**
 * RSA SubjectPublicKeyInfo handling for Privacy Pass token keys.
 *
 * # The problem
 *
 * Token type 0x0002 is RSABSSA-SHA384-PSS-Deterministic (RFC 9474, RFC 9578).
 * The blinding happens on the client, so what reaches a verifier is an
 * ordinary RSASSA-PSS signature. Checking one needs only the issuer's RSA
 * public key, SHA-384, MGF1-SHA-384 and a 48-byte salt.
 *
 * RFC 9578 section 6.5 requires the issuer to publish that key as an SPKI whose
 * AlgorithmIdentifier is `id-RSASSA-PSS` (1.2.840.113549.1.1.10) with explicit
 * RSASSA-PSS-params (RFC 4055 section 3.1), rather than the generic
 * `rsaEncryption` (1.2.840.113549.1.1.1). Link publishes exactly that.
 *
 * Neither crypto API available to JavaScript accepts that key in every runtime
 * this package supports:
 *
 * - Web Crypto imports an RSA-PSS public key only from an `rsaEncryption`
 *   SPKI. Chromium documents this, and in Cloudflare Workers (BoringSSL)
 *   `subtle.importKey('spki', ...)` fails on Link's key with "Invalid SPKI
 *   input". `jose`'s `importSPKI` is built on Web Crypto and fails the same
 *   way.
 * - `node:crypto` parses the key in Node, but Workers' `nodejs_compat` layer is
 *   a partial reimplementation of it. `createPublicKey` rejects the key, which
 *   the issuer surfaces as "none usable by this verifier", and `crypto.verify`
 *   refuses a `KeyObject` ("options.key ... Received an instance of
 *   PublicKeyObject"). No compatibility flag changes either.
 *
 * # The workaround
 *
 * The usual workaround among Privacy Pass implementations is to re-wrap the
 * key. The BIT STRING inside the SPKI holds a plain `RSAPublicKey { n, e }`,
 * whichever AlgorithmIdentifier precedes it. Wrapped in an `rsaEncryption`
 * SPKI, it imports with Web Crypto as `{ name: 'RSA-PSS', hash: 'SHA-384' }`,
 * and verification passes `saltLength: 48` to `subtle.verify`. Cloudflare's
 * `@cloudflare/privacypass-ts` does the same in `convertRSASSAPSSToEnc`, also
 * built on `asn1js`. This package already re-wrapped on Node before it
 * supported Workers.
 *
 * Re-wrapping discards the parameters the issuer declared, so they are parsed
 * first and returned for `importTokenKey` to check. A key declaring SHA-256 or
 * a 32-byte salt belongs to a different scheme from the one signatures are
 * verified under here, and must be refused rather than silently verified with
 * other parameters. `privacypass-ts` re-wraps without this check.
 *
 * Token key IDs are SHA-256 over the published bytes (RFC 9578 section 6.5),
 * never over the re-wrapped ones. Only the copy handed to Web Crypto changes.
 *
 * # Parsing
 *
 * `asn1js` decodes the DER. It has been maintained by PeculiarVentures since
 * 2014, underlies PKI.js, and is what `privacypass-ts` uses for this
 * conversion. Version 3 ships CommonJS and runs on Node 22.0; version 4 adds a
 * dependency on the newer `@peculiar/utils`.
 *
 * `asn1js` is a BER decoder, and this input is fetched from the network, so
 * DER is enforced here on top of it:
 *
 * - The decoded value must re-encode to exactly the bytes received. That
 *   refuses trailing data, non-minimal lengths and other BER encodings that
 *   `toBER()` normalizes away.
 * - Indefinite lengths are refused explicitly, because `asn1js` re-encodes
 *   them in the same form and the round trip alone would not notice.
 * - INTEGERs must be non-negative and minimally encoded. OpenSSL tolerates
 *   both, but neither occurs in a legitimately published key, and the round
 *   trip preserves INTEGER content bytes as received.
 *
 * Hash AlgorithmIdentifiers may carry an explicit NULL, as OpenSSL writes them,
 * or omit it, as Link's key does. Both are valid, so the parameters are read
 * field by field rather than compared against one fixed byte string, which
 * would break if the issuer's tooling changed.
 *
 * The re-wrap itself uses the fixed encoders at the end of this file. Each has
 * exactly one legal value, and the tests check them byte for byte against
 * Link's published key.
 */
import * as asn1js from 'asn1js';

/** Hard ceiling on any parsed structure. A published key is a few hundred bytes. */
const MAX_SPKI_BYTES = 8192;

const TAG_BIT_STRING = 0x03;
const TAG_SEQUENCE = 0x30;

const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_RSASSA_PSS = '1.2.840.113549.1.1.10';
const OID_MGF1 = '1.2.840.113549.1.1.8';

/** Hash OIDs, named as Web Crypto names them so `importTokenKey` can compare. */
const HASH_NAMES: ReadonlyMap<string, string> = new Map([
  ['1.3.14.3.2.26', 'SHA-1'],
  ['2.16.840.1.101.3.4.2.4', 'SHA-224'],
  ['2.16.840.1.101.3.4.2.1', 'SHA-256'],
  ['2.16.840.1.101.3.4.2.2', 'SHA-384'],
  ['2.16.840.1.101.3.4.2.3', 'SHA-512'],
  ['2.16.840.1.101.3.4.2.5', 'SHA512-224'],
  ['2.16.840.1.101.3.4.2.6', 'SHA512-256'],
]);

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
  /** Modulus length in bits. */
  modulusBits: number;
  /** Present only for `id-RSASSA-PSS`, which carries explicit parameters. */
  pssParams?: PssParams | undefined;
}

function fail(message: string): never {
  throw new Error(message);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function hasIndefiniteLength(block: asn1js.AsnType): boolean {
  if (block.lenBlock.isIndefiniteForm) return true;
  // Only constructed encodings contain nested elements. A primitive's value
  // block holds decoded parts, such as an OID's arcs, not ASN.1 elements.
  if (!block.idBlock.isConstructed) return false;
  const children = (block.valueBlock as { value?: asn1js.AsnType[] }).value;
  return children?.some(hasIndefiniteLength) ?? false;
}

/** Decodes one DER element that must span `der` exactly. */
function decodeDer(der: Uint8Array, what: string): asn1js.AsnType {
  const { offset, result } = asn1js.fromBER(der);
  if (offset === -1) fail(`${what}: ${result.error}`);
  if (offset !== der.length) fail(`${what} has trailing bytes`);
  if (hasIndefiniteLength(result)) fail(`${what} uses an indefinite length`);
  if (!bytesEqual(new Uint8Array(result.toBER()), der))
    fail(`${what} is not DER-encoded`);
  return result;
}

/**
 * Whether `block` carries exactly this universal tag and form. `instanceof`
 * alone is not enough: asn1js decodes a primitive-form SEQUENCE (0x10) as a
 * `Sequence`, and its `Enumerated` extends `Integer`.
 */
function hasTag(
  block: asn1js.AsnType,
  tagNumber: number,
  constructed: boolean,
): boolean {
  const { tagClass, tagNumber: actual, isConstructed } = block.idBlock;
  return (
    tagClass === 1 && actual === tagNumber && isConstructed === constructed
  );
}

const UNIVERSAL = { INTEGER: 2, BIT_STRING: 3, NULL: 5, OID: 6, SEQUENCE: 16 };

function isNull(block: asn1js.AsnType | undefined): boolean {
  return block instanceof asn1js.Null && hasTag(block, UNIVERSAL.NULL, false);
}

/** The members of a SEQUENCE, refusing anything else. */
function sequence(block: asn1js.AsnType | undefined, what: string) {
  if (
    !(block instanceof asn1js.Sequence) ||
    !hasTag(block, UNIVERSAL.SEQUENCE, true)
  )
    fail(`expected ${what} SEQUENCE`);
  return block.valueBlock.value;
}

function oid(block: asn1js.AsnType | undefined, what: string): string {
  if (
    !(block instanceof asn1js.ObjectIdentifier) ||
    !hasTag(block, UNIVERSAL.OID, false)
  )
    fail(`expected ${what} OBJECT IDENTIFIER`);
  return block.getValue();
}

/** A non-negative, minimally encoded INTEGER's magnitude, without the sign byte. */
function unsignedInteger(
  block: asn1js.AsnType | undefined,
  what: string,
): Uint8Array {
  if (
    !(block instanceof asn1js.Integer) ||
    !hasTag(block, UNIVERSAL.INTEGER, false)
  )
    fail(`expected ${what} INTEGER`);
  const bytes = block.valueBlock.valueHexView;
  if (bytes.length === 0) fail(`${what} is an empty INTEGER`);
  if (((bytes[0] as number) & 0x80) !== 0) fail(`${what} is negative`);
  if (bytes.length > 1 && bytes[0] === 0 && ((bytes[1] as number) & 0x80) === 0)
    fail(`${what} is not minimally encoded`);
  return bytes[0] === 0 ? bytes.subarray(1) : bytes;
}

function toBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/** `AlgorithmIdentifier { hash, NULL or absent }`, as a Web Crypto hash name. */
function hashAlgorithm(
  block: asn1js.AsnType | undefined,
  what: string,
): string {
  const [algorithm, params, ...rest] = sequence(block, what);
  if (rest.length > 0) fail(`${what} has trailing members`);
  if (params !== undefined && !isNull(params))
    fail(`${what} parameters are not NULL`);
  const name = HASH_NAMES.get(oid(algorithm, what));
  if (name === undefined) fail(`${what} is not a supported hash`);
  return name;
}

/** Reads `RSASSA-PSS-params`, which this profile requires to be explicit. */
function readPssParams(block: asn1js.AsnType | undefined): PssParams | string {
  if (block === undefined) return 'id-RSASSA-PSS key carries no parameters';
  // Each member is an explicitly tagged [0]..[3], in declaration order.
  const fields = new Map<number, asn1js.AsnType | undefined>();
  let previous = -1;
  for (const field of sequence(block, 'RSASSA-PSS-params')) {
    const { tagClass, tagNumber } = field.idBlock;
    if (
      tagClass !== 3 ||
      tagNumber > 3 ||
      tagNumber <= previous ||
      !(field instanceof asn1js.Constructed) ||
      field.valueBlock.value.length !== 1
    )
      return 'unexpected PSS parameter';
    previous = tagNumber;
    fields.set(tagNumber, field.valueBlock.value[0]);
  }
  // DER omits a member equal to its default, but WebCrypto always uses trailer
  // 0xBC (trailerField 1) and would silently replace any other value.
  if (fields.has(3)) {
    const trailer = unsignedInteger(fields.get(3), 'PSS trailerField');
    if (trailer.length !== 1 || trailer[0] !== 1)
      return 'RSASSA-PSS-params trailerField is not 1';
  }
  // The defaults are SHA-1, MGF1-SHA-1 and 20 bytes, none of which this profile
  // allows, so an omitted member is refused by name.
  if (!fields.has(0) || !fields.has(1) || !fields.has(2))
    return 'RSASSA-PSS-params omits hash, MGF1, or salt length';

  const hash = hashAlgorithm(fields.get(0), 'PSS hashAlgorithm');
  const [mgf, mgfHash, ...rest] = sequence(
    fields.get(1),
    'PSS maskGenAlgorithm',
  );
  if (rest.length > 0) fail('PSS maskGenAlgorithm has trailing members');
  if (oid(mgf, 'PSS maskGenAlgorithm') !== OID_MGF1)
    fail('PSS maskGenAlgorithm is not MGF1');
  const salt = unsignedInteger(fields.get(2), 'PSS saltLength');
  if (salt.length > 2) fail('PSS saltLength is implausibly large');
  return {
    hash,
    mgf1Hash: hashAlgorithm(mgfHash, 'MGF1 hashAlgorithm'),
    saltLength: Number(toBigInt(salt)),
  };
}

/**
 * Parses an RSA SPKI and returns what `importTokenKey` checks and re-wraps.
 *
 * Returns a string on failure: the input is a document fetched from a remote
 * issuer, so a key that cannot be used is an operational condition.
 */
export function parseRsaSpki(der: Uint8Array): ParsedRsaSpki | string {
  try {
    if (der.length > MAX_SPKI_BYTES) return 'SPKI is implausibly large';
    const [algorithm, bits, ...rest] = sequence(
      decodeDer(der, 'SPKI'),
      'SubjectPublicKeyInfo',
    );
    if (rest.length > 0) return 'SubjectPublicKeyInfo has trailing bytes';
    if (
      !(bits instanceof asn1js.BitString) ||
      !hasTag(bits, UNIVERSAL.BIT_STRING, false)
    )
      fail('expected subjectPublicKey BIT STRING');
    if (bits.valueBlock.unusedBits !== 0)
      return 'subjectPublicKey has unused bits';

    const [algorithmOid, params, ...extra] = sequence(
      algorithm,
      'AlgorithmIdentifier',
    );
    if (extra.length > 0) fail('AlgorithmIdentifier has trailing members');
    let encoding: SpkiEncoding;
    let pssParams: PssParams | undefined;
    switch (oid(algorithmOid, 'algorithm')) {
      case OID_RSA_ENCRYPTION:
        // RFC 3279 section 2.3.1: the parameters must be NULL.
        if (!isNull(params)) fail('rsaEncryption parameters are not NULL');
        encoding = 'rsaEncryption';
        break;
      case OID_RSASSA_PSS: {
        const parsed = readPssParams(params);
        if (typeof parsed === 'string') return parsed;
        encoding = 'id-RSASSA-PSS';
        pssParams = parsed;
        break;
      }
      default:
        return 'SPKI algorithm is neither rsaEncryption nor id-RSASSA-PSS';
    }

    // RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
    const rsaPublicKey = bits.valueBlock.valueHexView;
    const [n, e, ...more] = sequence(
      decodeDer(rsaPublicKey, 'RSAPublicKey'),
      'RSAPublicKey',
    );
    if (more.length > 0) fail('RSAPublicKey has trailing members');
    const modulus = unsignedInteger(n, 'modulus');
    const exponent = toBigInt(unsignedInteger(e, 'publicExponent'));
    if (exponent < 3n || exponent % 2n === 0n) {
      return `RSA public exponent ${exponent} is not a valid odd exponent`;
    }
    return {
      encoding,
      rsaPublicKey: new Uint8Array(rsaPublicKey),
      modulusBits:
        (modulus.length - 1) * 8 + (32 - Math.clz32(modulus[0] as number)),
      pssParams,
    };
  } catch (error) {
    return `malformed SPKI: ${error instanceof Error ? error.message : 'key could not be parsed'}`;
  }
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
