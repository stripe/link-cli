/**
 * Node validates RSA keys and exposes their modulus and PSS parameters.
 * The small DER adapter preserves the SDK's public CryptoKey return type:
 * WebCrypto cannot import id-RSASSA-PSS, and Node cannot export it as JWK.
 * Only the SPKI envelope is changed; token key IDs use the published bytes.
 */
import { Buffer } from 'node:buffer';
import { createPublicKey } from 'node:crypto';

const TAG_BIT_STRING = 0x03;
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
  /** Modulus length in bits, reported by Node. */
  modulusBits: number;
  /** Present only for `id-RSASSA-PSS`, which carries explicit parameters. */
  pssParams?: PssParams | undefined;
}

interface Tlv {
  tag: number;
  contents: Uint8Array;
  end: number;
}

function throwDer(message: string): never {
  throw new Error(message);
}

/** Reads one tag-length-value at `offset`. */
function readTlv(input: Uint8Array, offset: number): Tlv {
  if (offset + 2 > input.length) throwDer('truncated DER element');
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
      throwDer('unsupported DER length encoding');
    if (cursor + byteCount > input.length) throwDer('truncated DER length');
    length = 0;
    for (let i = 0; i < byteCount; i++) {
      length = (length << 8) | (input[cursor + i] as number);
    }
    // DER requires the minimal encoding: the long form must be necessary, and its
    // first byte must be non-zero. `0x82 0x00 0x80` encodes 128 in two bytes and
    // would otherwise pass.
    if (input[cursor] === 0) throwDer('non-minimal DER length');
    cursor += byteCount;
    if (length < 0x80) throwDer('non-minimal DER length');
  }

  if (length > MAX_SPKI_BYTES) throwDer('DER element is implausibly large');
  if (cursor + length > input.length)
    throwDer('DER element runs past the end of input');
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
    throwDer(
      `expected ${what} (tag 0x${tag.toString(16)}), got tag 0x${tlv.tag.toString(16)}`,
    );
  }
  return tlv;
}

/** Validates the key with Node and extracts the RSA bytes for envelope conversion. */
export function parseRsaSpki(der: Uint8Array): ParsedRsaSpki | string {
  try {
    if (der.length > MAX_SPKI_BYTES) return 'SPKI is implausibly large';
    const outer = expect(der, 0, TAG_SEQUENCE, 'SubjectPublicKeyInfo');
    if (outer.end !== der.length) return 'SPKI has trailing bytes';
    const algorithm = expect(
      outer.contents,
      0,
      TAG_SEQUENCE,
      'AlgorithmIdentifier',
    );
    const bits = expect(
      outer.contents,
      algorithm.end,
      TAG_BIT_STRING,
      'subjectPublicKey',
    );
    if (bits.end !== outer.contents.length)
      return 'SubjectPublicKeyInfo has trailing bytes';
    if (bits.contents[0] !== 0) return 'subjectPublicKey has unused bits';

    const key = createPublicKey({
      key: Buffer.from(der),
      format: 'der',
      type: 'spki',
    });
    if (
      key.asymmetricKeyType !== 'rsa' &&
      key.asymmetricKeyType !== 'rsa-pss'
    ) {
      return 'SPKI algorithm is neither rsaEncryption nor id-RSASSA-PSS';
    }
    const details = key.asymmetricKeyDetails;
    if (
      details?.modulusLength === undefined ||
      details.publicExponent === undefined
    ) {
      return 'RSA key has no modulus or exponent';
    }
    if (details.publicExponent < 3n || details.publicExponent % 2n === 0n) {
      return `RSA public exponent ${details.publicExponent} is not a valid odd exponent`;
    }
    let pssParams: PssParams | undefined;
    if (key.asymmetricKeyType === 'rsa-pss') {
      // Node exposes hash/MGF1/salt, but omits the trailer field and accepts
      // values WebCrypto would silently replace with its fixed trailer 0xBC.
      const oid = readTlv(algorithm.contents, 0);
      const params = expect(
        algorithm.contents,
        oid.end,
        TAG_SEQUENCE,
        'RSASSA-PSS-params',
      );
      const fields = new Set<number>();
      for (let cursor = 0; cursor < params.contents.length; ) {
        const field = readTlv(params.contents, cursor);
        cursor = field.end;
        if (fields.has(field.tag) || field.tag < 0xa0 || field.tag > 0xa3)
          return 'unexpected PSS parameter';
        fields.add(field.tag);
        if (
          field.tag === 0xa3 &&
          !Buffer.from(field.contents).equals(Buffer.from([0x02, 0x01, 0x01]))
        ) {
          return 'RSASSA-PSS-params trailerField is not 1';
        }
      }
      if (![0xa0, 0xa1, 0xa2].every((tag) => fields.has(tag)))
        return 'RSASSA-PSS-params omits hash, MGF1, or salt length';
      if (
        details.hashAlgorithm === undefined ||
        details.mgf1HashAlgorithm === undefined ||
        details.saltLength === undefined
      ) {
        return 'id-RSASSA-PSS key carries no parameters';
      }
      pssParams = {
        hash: hashName(details.hashAlgorithm),
        mgf1Hash: hashName(details.mgf1HashAlgorithm),
        saltLength: details.saltLength,
      };
    }
    return {
      encoding:
        key.asymmetricKeyType === 'rsa-pss' ? 'id-RSASSA-PSS' : 'rsaEncryption',
      rsaPublicKey: bits.contents.subarray(1),
      modulusBits: details.modulusLength,
      pssParams,
    };
  } catch (error) {
    return `malformed SPKI: ${error instanceof Error ? error.message : 'key could not be parsed'}`;
  }
}

function hashName(name: string): string {
  return name.toUpperCase().replace(/^SHA(\d+)$/, 'SHA-$1');
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
