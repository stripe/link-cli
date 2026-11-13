import { randomBytes, randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBase64url, encodeBase64url } from '@/internal/identity/base64url';

// The acceptance rule this module must match: Buffer's lenient decoder followed
// by a check that the input is the canonical encoding of the decoded bytes.
function bufferAccepts(value: string): boolean {
  return Buffer.from(value, 'base64url').toString('base64url') === value;
}

describe('encodeBase64url', () => {
  it.each([
    [[], ''],
    [[0], 'AA'],
    [[0xff], '_w'],
    [[0xfb, 0xff], '-_8'],
    [[0xfb, 0xff, 0xbf], '-_-_'],
    [[1, 2, 3, 4], 'AQIDBA'],
  ])('encodes %j as %s', (bytes, expected) => {
    expect(encodeBase64url(new Uint8Array(bytes))).toBe(expected);
  });

  it('matches Buffer for every length up to 64 bytes', () => {
    for (let length = 0; length <= 64; length++) {
      const bytes = randomBytes(length);
      expect(encodeBase64url(new Uint8Array(bytes))).toBe(
        bytes.toString('base64url'),
      );
    }
  });
});

describe('decodeBase64url', () => {
  it.each([
    ['', []],
    ['AA', [0]],
    ['_w', [0xff]],
    ['-_8', [0xfb, 0xff]],
    ['AQIDBA', [1, 2, 3, 4]],
  ])('decodes canonical %j', (value, expected) => {
    expect(decodeBase64url(value)).toEqual(new Uint8Array(expected));
  });

  it.each([
    ['padding', 'AA=='],
    ['standard alphabet plus', '+w'],
    ['standard alphabet slash', '/w'],
    ['whitespace', 'AA AA'],
    ['trailing newline', 'AA\n'],
    ['length 1 mod 4', 'AAAAA'],
    ['nonzero trailing bits in one byte', 'AB'],
    ['nonzero trailing bits in two bytes', 'AAB'],
    ['non-ASCII', 'AAé'],
    ['astral character', 'AA\u{1f600}'],
  ])('rejects %s', (_name, value) => {
    expect(bufferAccepts(value)).toBe(false);
    expect(decodeBase64url(value)).toBeUndefined();
  });

  it('accepts exactly the strings Buffer round-trips, with the same bytes', () => {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_+/= .';
    for (let i = 0; i < 5000; i++) {
      let value = '';
      const length = randomInt(0, 13);
      for (let j = 0; j < length; j++) {
        value += alphabet[randomInt(0, alphabet.length)];
      }
      const decoded = decodeBase64url(value);
      expect(decoded !== undefined, value).toBe(bufferAccepts(value));
      if (decoded) {
        expect(decoded).toEqual(
          new Uint8Array(Buffer.from(value, 'base64url')),
        );
      }
    }
  });
});
