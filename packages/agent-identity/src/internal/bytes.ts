/** Node byte helpers with strict validation at the decoding boundary. */
import { Buffer } from 'node:buffer';
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** base64url with no padding, which is what JOSE and the token wire use. */
export function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
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
  return padBase64url(toBase64url(bytes));
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
  return Buffer.from(bytes).toString('base64');
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
  // Buffer silently skips invalid characters, so validate before decoding.
  if (/[^A-Za-z0-9+/_-]/.test(input.slice(0, end))) {
    throw new Error('invalid base64 input');
  }
  return new Uint8Array(Buffer.from(input, 'base64url'));
}

export function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

/** Constant-time comparison. Used for digests, so length is not secret. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nodeTimingSafeEqual(a, b);
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
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
