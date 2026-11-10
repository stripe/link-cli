const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALUES = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Encodes bytes as unpadded base64url. */
export function encodeBase64url(bytes: Uint8Array): string {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk =
      ((bytes[i] as number) << 16) |
      ((bytes[i + 1] ?? 0) << 8) |
      (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) {
      output += ALPHABET[(chunk >> (18 - j * 6)) & 63];
    }
  }
  return output;
}

/**
 * Decodes canonical unpadded base64url, or returns undefined.
 *
 * Accepts exactly the strings that re-encode to themselves: no padding, no
 * standard-alphabet characters, no whitespace, and no nonzero trailing bits.
 */
export function decodeBase64url(value: string): Uint8Array | undefined {
  if (value.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((value.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const char of value) {
    const digit = VALUES.get(char);
    if (digit === undefined) return undefined;
    buffer = ((buffer << 6) | digit) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >> bits) & 0xff;
    }
  }
  return encodeBase64url(bytes) === value ? bytes : undefined;
}
