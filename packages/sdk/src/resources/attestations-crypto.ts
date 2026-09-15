/**
 * Client-side Blind RSA for Privacy Pass token type 0x0002.
 *
 * The client builds the token input, PSS-encodes and blinds it, then sends
 * only the blinded message to the issuer. After signing, the client unblinds
 * and verifies the signature before assembling the final token. This module
 * implements only the RFC 9578 profile: 2048-bit RSA, SHA-384, and a 48-byte
 * PSS salt.
 */
import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const TOKEN_TYPE = 0x0002;
const NONCE_SIZE = 32;
const CHALLENGE_DIGEST_SIZE = 32;
const TOKEN_KEY_ID_SIZE = 32;

/** RSA public values needed by the blinding and verification operations. */
interface RsaPublicKey {
  n: bigint;
  e: bigint;
  nLen: number;
}

/** Per-token secrets retained locally while the issuer signs the blind. */
interface BlindedToken {
  nonce: Uint8Array;
  blindedMsg: Uint8Array;
  blindInverse: bigint;
  encodedMessage: Uint8Array;
}

/** Local state needed to finalize a batch of blinded token requests. */
export interface BlindingState {
  tokens: BlindedToken[];
  publicKey: RsaPublicKey;
  challengeDigest: Uint8Array;
  tokenKeyId: Uint8Array;
}

/** A complete binary token and its base64url transport form. */
export interface FinalToken {
  raw: Uint8Array;
  base64url: string;
}

/** Encodes bytes as unpadded base64url. */
export function base64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

/** Decodes an unpadded base64url value into bytes. */
function base64urlDecode(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

/** Interprets big-endian bytes as a non-negative integer. */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex.length === 0 ? 0n : BigInt(`0x${hex}`);
}

/** Serializes a non-negative integer to an exact-length big-endian buffer. */
function bigIntToBytes(n: bigint, length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error('Integer encoding length must be a non-negative integer');
  }
  if (n < 0n || n >= 1n << BigInt(length * 8)) {
    throw new Error(`Integer does not fit in ${length} bytes`);
  }
  const hex = n.toString(16).padStart(length * 2, '0');
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Returns the number of significant bits in a positive integer. */
function bitLength(value: bigint): number {
  if (value <= 0n) throw new Error('Bit length requires a positive integer');
  return value.toString(2).length;
}

/** Computes base^exp modulo mod with square-and-multiply. */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) % mod;
    }
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

/** Computes a modular inverse, failing when the values are not coprime. */
function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) {
    throw new Error('Value has no modular inverse');
  }
  return ((oldS % m) + m) % m;
}

/** Computes the greatest common divisor with Euclid's algorithm. */
function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Extracts the RSA modulus and exponent from a DER-encoded SPKI key. */
function parseSpkiPublicKey(spkiDer: Uint8Array): RsaPublicKey {
  let keyObject: ReturnType<typeof createPublicKey>;
  try {
    keyObject = createPublicKey({
      key: Buffer.from(spkiDer),
      format: 'der',
      type: 'spki',
    });
  } catch (error) {
    throw new Error('Invalid RSA issuer public key', { cause: error });
  }
  const details = keyObject.asymmetricKeyDetails;
  if (
    keyObject.asymmetricKeyType !== 'rsa-pss' ||
    details?.modulusLength !== 2048 ||
    details.hashAlgorithm !== 'sha384' ||
    details.mgf1HashAlgorithm !== 'sha384' ||
    details.saltLength !== 48
  ) {
    throw new Error(
      'Issuer key must use 2048-bit RSA-PSS with SHA-384, MGF1-SHA-384, and a 48-byte salt',
    );
  }

  // SubjectPublicKeyInfo ::= SEQUENCE { algorithm AlgorithmIdentifier, subjectPublicKey BIT STRING }
  // RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
  //
  // The DER must be walked structurally, not scanned for tag bytes: an
  // id-RSASSA-PSS AlgorithmIdentifier carries nested hash/MGF1/saltLength
  // parameters whose bytes include values that look like BIT STRING and
  // INTEGER tags.
  const spki = readSequence(spkiDer, 0);

  // Skip the AlgorithmIdentifier, then read the BIT STRING that follows it.
  const algorithm = readTlv(spkiDer, spki.contentStart);
  const bitString = readTlv(spkiDer, algorithm.end);
  if (bitString.tag !== 0x03) {
    throw new Error(
      `Expected BIT STRING in SPKI, got 0x${bitString.tag.toString(16)}`,
    );
  }
  if (
    bitString.contentStart >= bitString.end ||
    spkiDer[bitString.contentStart] !== 0
  ) {
    throw new Error('RSA SPKI BIT STRING must have zero unused bits');
  }

  // First content byte of a BIT STRING is the unused-bits count (0 here).
  const rsaPublicKeyDer = spkiDer.slice(
    bitString.contentStart + 1,
    bitString.end,
  );

  const rsaPublicKey = readSequence(rsaPublicKeyDer, 0);
  const modulus = readInteger(rsaPublicKeyDer, rsaPublicKey.contentStart);
  const exponent = readInteger(rsaPublicKeyDer, modulus.end);
  const n = bytesToBigInt(modulus.value);
  const e = bytesToBigInt(exponent.value);

  if (modulus.value.length !== 256 || bitLength(n) !== 2048) {
    throw new Error('Token type 0x0002 requires a 2048-bit RSA modulus');
  }
  if (e < 3n || e % 2n === 0n) {
    throw new Error('RSA public exponent must be an odd integer of at least 3');
  }

  return {
    n,
    e,
    nLen: modulus.value.length,
  };
}

/** Bounds for a parsed DER tag-length-value element. */
interface Tlv {
  tag: number;
  contentStart: number;
  end: number;
}

/** Reads one DER tag-length-value element and checks its bounds. */
function readTlv(data: Uint8Array, offset: number): Tlv {
  if (offset >= data.length) {
    throw new Error(`Unexpected end of DER at offset ${offset}`);
  }
  const tag = data[offset];
  if (tag === undefined) {
    throw new Error(`Unexpected end of DER at offset ${offset}`);
  }
  const { value: length, bytesRead } = parseDerLength(data, offset + 1);
  const contentStart = offset + 1 + bytesRead;
  const end = contentStart + length;
  if (end > data.length) {
    throw new Error(`DER element at offset ${offset} overruns the buffer`);
  }
  return { tag, contentStart, end };
}

/** Reads a DER SEQUENCE element. */
function readSequence(data: Uint8Array, offset: number): Tlv {
  const tlv = readTlv(data, offset);
  if (tlv.tag !== 0x30) {
    throw new Error(
      `Expected SEQUENCE at offset ${offset}, got 0x${tlv.tag.toString(16)}`,
    );
  }
  return tlv;
}

/** Reads a positive DER INTEGER and removes its optional sign byte. */
function readInteger(
  data: Uint8Array,
  offset: number,
): { value: Uint8Array; end: number } {
  const tlv = readTlv(data, offset);
  if (tlv.tag !== 0x02) {
    throw new Error(
      `Expected INTEGER at offset ${offset}, got 0x${tlv.tag.toString(16)}`,
    );
  }
  let value = data.slice(tlv.contentStart, tlv.end);
  // Strip the DER sign byte.
  if (value.length > 1 && value[0] === 0x00) {
    value = value.slice(1);
  }
  return { value, end: tlv.end };
}

/** Decodes a DER short- or long-form length. */
function parseDerLength(
  data: Uint8Array,
  offset: number,
): { value: number; bytesRead: number } {
  const first = data[offset];
  if (first === undefined) {
    throw new Error(`Unexpected end of DER at offset ${offset}`);
  }
  if (first < 0x80) {
    return { value: first, bytesRead: 1 };
  }
  const numBytes = first & 0x7f;
  if (numBytes === 0 || offset + numBytes >= data.length) {
    throw new Error(`Invalid DER length at offset ${offset}`);
  }
  let value = 0;
  for (let i = 0; i < numBytes; i++) {
    const byte = data[offset + 1 + i];
    if (byte === undefined) {
      throw new Error(`Unexpected end of DER at offset ${offset + 1 + i}`);
    }
    value = value * 256 + byte;
  }
  return { value, bytesRead: 1 + numBytes };
}

/** PSS-encodes a message with SHA-384 and a fresh 48-byte salt. */
function emsaPssEncode(message: Uint8Array, emBits: number): Uint8Array {
  const hashAlg = 'sha384';
  const hLen = 48; // SHA-384 output
  const sLen = 48; // salt length = hash length for RSABSSA-SHA384-PSS
  const emLen = Math.ceil(emBits / 8);

  const mHash = createHash(hashAlg).update(message).digest();
  if (emLen < hLen + sLen + 2) {
    throw new Error('Encoding error: emLen too small');
  }

  const salt = randomBytes(sLen);
  // M' = (0x)00 00 00 00 00 00 00 00 || mHash || salt
  const mPrime = Buffer.concat([Buffer.alloc(8), mHash, salt]);
  const h = createHash(hashAlg).update(mPrime).digest();

  const ps = Buffer.alloc(emLen - sLen - hLen - 2);
  const db = Buffer.concat([ps, Buffer.from([0x01]), salt]);

  const dbMask = mgf1(h, db.length, hashAlg);
  const maskedDb = Buffer.alloc(db.length);
  for (let i = 0; i < db.length; i++) {
    maskedDb.writeUInt8(db.readUInt8(i) ^ dbMask.readUInt8(i), i);
  }

  // Set the leftmost bits to zero.
  const topBits = 8 * emLen - emBits;
  maskedDb.writeUInt8(maskedDb.readUInt8(0) & (0xff >> topBits), 0);

  return new Uint8Array(Buffer.concat([maskedDb, h, Buffer.from([0xbc])]));
}

/** Expands a seed with MGF1 to the requested number of bytes. */
function mgf1(seed: Buffer, length: number, hashAlg: string): Buffer {
  const hLen = hashAlg === 'sha384' ? 48 : 32;
  const result = Buffer.alloc(length);
  let offset = 0;
  let counter = 0;

  while (offset < length) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter);
    const hash = createHash(hashAlg).update(seed).update(c).digest();
    const toCopy = Math.min(hLen, length - offset);
    hash.copy(result, offset, 0, toCopy);
    offset += toCopy;
    counter++;
  }

  return result;
}

/** Samples a uniform invertible blinding factor from [1, n). */
function generateBlindingFactor(
  n: bigint,
  nLen: number,
): { r: bigint; rInv: bigint } {
  while (true) {
    const rBytes = randomBytes(nLen);
    const r = bytesToBigInt(new Uint8Array(rBytes));
    if (r < 1n || r >= n) continue;
    try {
      const rInv = modInverse(r, n);
      return { r, rInv };
    } catch {
      // A non-invertible sample is negligible for an honest RSA modulus.
    }
  }
}

/** Creates blinded issuer requests and retains the state needed to finalize them. */
export function generateBlindedMessages(
  spkiDer: Uint8Array,
  count: number,
  challengeDigest: Uint8Array,
): BlindingState {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('Token count must be an integer from 1 to 100');
  }
  if (challengeDigest.length !== CHALLENGE_DIGEST_SIZE) {
    throw new Error('Challenge digest must be exactly 32 bytes');
  }

  const publicKey = parseSpkiPublicKey(spkiDer);
  const tokenKeyId = new Uint8Array(
    createHash('sha256').update(spkiDer).digest(),
  );

  const emBits = bitLength(publicKey.n) - 1;
  const tokens: BlindedToken[] = [];

  for (let i = 0; i < count; i++) {
    const nonce = new Uint8Array(randomBytes(NONCE_SIZE));
    const tokenInput = new Uint8Array(
      2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE + TOKEN_KEY_ID_SIZE,
    );
    tokenInput[0] = (TOKEN_TYPE >> 8) & 0xff;
    tokenInput[1] = TOKEN_TYPE & 0xff;
    tokenInput.set(nonce, 2);
    tokenInput.set(challengeDigest, 2 + NONCE_SIZE);
    tokenInput.set(tokenKeyId, 2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE);

    const encoded = emsaPssEncode(tokenInput, emBits);
    const message = bytesToBigInt(encoded);
    if (greatestCommonDivisor(message, publicKey.n) !== 1n) {
      throw new Error(
        'PSS-encoded token input is not coprime to the RSA modulus',
      );
    }
    const { r, rInv } = generateBlindingFactor(publicKey.n, publicKey.nLen);
    const blindedMessage =
      (message * modPow(r, publicKey.e, publicKey.n)) % publicKey.n;

    tokens.push({
      nonce,
      blindedMsg: bigIntToBytes(blindedMessage, publicKey.nLen),
      blindInverse: rInv,
      encodedMessage: encoded,
    });
  }

  return { tokens, publicKey, challengeDigest, tokenKeyId };
}

/** Unblinds issuer responses, verifies them, and assembles complete tokens. */
export function unblindSignatures(
  state: BlindingState,
  blindSigs: string[],
): FinalToken[] {
  const { tokens, publicKey, tokenKeyId } = state;

  if (blindSigs.length !== tokens.length) {
    throw new Error(
      `Expected ${tokens.length} blind signatures, got ${blindSigs.length}`,
    );
  }

  const results: FinalToken[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const blindSignature = blindSigs[i];
    if (!token || blindSignature === undefined) {
      throw new Error(`Missing blind signature state at index ${i}`);
    }
    const blindSigBytes = base64urlDecode(blindSignature);
    if (blindSigBytes.length !== publicKey.nLen) {
      throw new Error(
        `Blind signature ${i} must be exactly ${publicKey.nLen} bytes`,
      );
    }
    const blindSigInt = bytesToBigInt(blindSigBytes);
    const sigInt = (blindSigInt * token.blindInverse) % publicKey.n;
    const authenticator = bigIntToBytes(sigInt, publicKey.nLen);
    const recoveredMessage = bigIntToBytes(
      modPow(sigInt, publicKey.e, publicKey.n),
      publicKey.nLen,
    );
    if (
      !timingSafeEqual(
        Buffer.from(recoveredMessage),
        Buffer.from(token.encodedMessage),
      )
    ) {
      throw new Error(`Blind signature ${i} failed verification`);
    }

    const raw = new Uint8Array(
      2 +
        NONCE_SIZE +
        CHALLENGE_DIGEST_SIZE +
        TOKEN_KEY_ID_SIZE +
        publicKey.nLen,
    );
    raw[0] = (TOKEN_TYPE >> 8) & 0xff;
    raw[1] = TOKEN_TYPE & 0xff;
    raw.set(token.nonce, 2);
    raw.set(state.challengeDigest, 2 + NONCE_SIZE);
    raw.set(tokenKeyId, 2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE);
    raw.set(
      authenticator,
      2 + NONCE_SIZE + CHALLENGE_DIGEST_SIZE + TOKEN_KEY_ID_SIZE,
    );

    results.push({
      raw,
      base64url: base64urlEncode(raw),
    });
  }

  return results;
}

/** Hashes the canonical empty-context TokenChallenge used for issuance. */
export function computeChallengeDigest(
  tokenType: number,
  issuerName: string,
): Uint8Array {
  const issuerBytes = Buffer.from(issuerName, 'utf-8');
  const originBytes = Buffer.alloc(0);

  if (!Number.isInteger(tokenType) || tokenType < 0 || tokenType > 0xffff) {
    throw new Error('Token type must fit in an unsigned 16-bit integer');
  }
  if (issuerBytes.length > 0xffff) {
    throw new Error('Issuer name must fit in an unsigned 16-bit length');
  }

  const challenge = Buffer.alloc(
    2 + 2 + issuerBytes.length + 1 + 2 + originBytes.length,
  );
  let offset = 0;

  challenge.writeUInt16BE(tokenType, offset);
  offset += 2;
  challenge.writeUInt16BE(issuerBytes.length, offset);
  offset += 2;
  issuerBytes.copy(challenge, offset);
  offset += issuerBytes.length;
  challenge.writeUInt8(0, offset);
  offset += 1;
  challenge.writeUInt16BE(originBytes.length, offset);
  offset += 2;
  if (originBytes.length > 0) {
    originBytes.copy(challenge, offset);
  }

  return new Uint8Array(createHash('sha256').update(challenge).digest());
}
