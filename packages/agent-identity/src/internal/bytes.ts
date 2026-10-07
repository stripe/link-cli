/** Byte and encoding helpers. No dependencies, no Node built-ins. */

const B64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_STD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) {
      if (pad) out += '==';
      break;
    }
    out += alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) {
      if (pad) out += '=';
      break;
    }
    out += alphabet[b2 & 0x3f];
  }
  return out;
}

/** base64url with no padding, which is what JOSE and the token wire use. */
export function toBase64url(bytes: Uint8Array): string {
  return encode(bytes, B64URL_ALPHABET, false);
}

/**
 * base64url *with* padding.
 *
 * RFC 9577 section 2.1.2 requires the `challenge` and `token-key` authentication
 * parameters to carry padding, following RFC 4648 section 3.2 default behaviour.
 * That is the opposite of the JOSE convention, so the two encoders are separate
 * rather than one with a flag callers can forget.
 */
export function toBase64urlPadded(bytes: Uint8Array): string {
  return encode(bytes, B64URL_ALPHABET, true);
}

/** Adds base64url padding to an already-encoded string. */
export function padBase64url(value: string): string {
  const remainder = value.length % 4;
  if (remainder === 0) return value;
  return value + '='.repeat(4 - remainder);
}

/**
 * Standard base64 with padding, which RFC 8941 byte sequences use inside their
 * `:...:` delimiters. `Content-Digest` and `Signature` are both byte sequences,
 * so they are not base64url.
 */
export function toBase64Std(bytes: Uint8Array): string {
  return encode(bytes, B64_STD_ALPHABET, true);
}

const DECODE_LOOKUP = new Map<string, number>();
for (let i = 0; i < B64_STD_ALPHABET.length; i++) {
  DECODE_LOOKUP.set(B64_STD_ALPHABET[i] as string, i);
}

/**
 * Accepts base64url or standard base64, with or without padding.
 *
 * Throws on any character outside both alphabets. Callers handling untrusted
 * input must catch: a malformed segment in an attacker-supplied credential
 * reaches here, and an uncaught throw at a front door is a denial of service.
 */
export function fromBase64(input: string): Uint8Array {
  // Scan once from the end; an unanchored suffix regex can backtrack over
  // every '=' in malformed input such as a long padding run followed by 'A'.
  let end = input.length;
  while (end > 0 && input[end - 1] === '=') end--;
  const padding = input.length - end;
  if (end % 4 === 1 || padding > 2 || (padding > 0 && input.length % 4 !== 0)) {
    throw new Error('invalid base64 padding');
  }
  const normalized = input.slice(0, end).replace(/-/g, '+').replace(/_/g, '/');

  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of normalized) {
    const v = DECODE_LOOKUP.get(ch);
    if (v === undefined) {
      throw new Error('invalid base64 input');
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Constant-time comparison. Used for digests, so length is not secret. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function uint16be(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

/**
 * Renders an untrusted string safe to put in a failure message.
 *
 * Failure messages get logged. Escape control characters and bound the length
 * so untrusted metadata cannot forge log lines or flood application logs.
 */
export function quoteForMessage(value: string, maxLength = 64): string {
  let out = '';
  for (const ch of value.slice(0, maxLength)) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else out += ch;
  }
  const suffix = value.length > maxLength ? '...' : '';
  return `"${out}${suffix}"`;
}

/**
 * WebCrypto's BufferSource wants an ArrayBuffer-backed view. TypeScript 5.7 made
 * Uint8Array generic over its backing buffer, so a plain Uint8Array no longer
 * satisfies it even though every value we pass is ArrayBuffer-backed. One cast
 * here beats a cast at every call site.
 */
export function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}
