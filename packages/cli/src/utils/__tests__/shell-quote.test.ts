import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { shellCommand, shellQuote } from '../shell-quote';

const PAYLOADS = [
  'https://merchant.example/pay$(touch /tmp/link-proof)',
  'https://merchant.example/pay`touch /tmp/link-proof`',
  'https://merchant.example/pay${IFS}x',
  "https://merchant.example/pay'; touch /tmp/link-proof; echo '",
  'https://merchant.example/pay; rm -rf /',
  'https://merchant.example/pay && whoami',
  'https://merchant.example/pay | tee /tmp/x',
  'https://merchant.example/pay > /tmp/x',
  'https://merchant.example/pay\ntouch /tmp/link-proof',
  'https://merchant.example/pay with spaces',
  "it's a trap",
  "''",
  '\\',
  '!!',
  '~/x',
  '*',
  'a\tb',
];

describe('shellQuote', () => {
  it('leaves ordinary URLs and IDs unquoted', () => {
    expect(shellQuote('https://merchant.example/pay')).toBe(
      'https://merchant.example/pay',
    );
    expect(shellQuote('sr_123abc')).toBe('sr_123abc');
    expect(shellQuote('POST')).toBe('POST');
  });

  it('quotes an empty string so it survives as an argument', () => {
    expect(shellQuote('')).toBe("''");
  });

  it('quotes values carrying shell metacharacters', () => {
    for (const payload of PAYLOADS) {
      const quoted = shellQuote(payload);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });

  it('escapes embedded single quotes rather than closing the quote', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  // The assertion that actually proves the encoder: hand the quoted value to a
  // real shell and require the byte-for-byte original back.
  it.each(PAYLOADS)('round-trips through bash: %j', (payload) => {
    const out = execFileSync(
      'bash',
      ['-c', `printf %s ${shellQuote(payload)}`],
      { encoding: 'utf8' },
    );
    expect(out).toBe(payload);
  });

  it('round-trips every argument of a multi-part command', () => {
    const args = ['pay', PAYLOADS[0], '-d', '{"a":"it\'s"}', '-H', 'X: a b'];
    const out = execFileSync(
      'bash',
      ['-c', `for a in ${shellCommand(args)}; do printf '%s\\n' "$a"; done`],
      { encoding: 'utf8' },
    );
    expect(out.split('\n').slice(0, args.length)).toEqual(args);
  });

  it('does not execute a command substitution payload', () => {
    const out = execFileSync(
      'bash',
      ['-c', `printf %s ${shellQuote('$(echo pwned)')}`],
      { encoding: 'utf8' },
    );
    expect(out).toBe('$(echo pwned)');
    expect(out).not.toContain('pwned\n');
  });
});
