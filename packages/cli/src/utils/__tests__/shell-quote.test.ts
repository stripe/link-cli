import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { posixShellCommand, posixShellQuote } from '../shell-quote';

const itPosix = process.platform === 'win32' ? it.skip : it;

const PAYLOADS = [
  'https://merchant.example/pay$(touch /tmp/link-proof)',
  'https://merchant.example/pay`touch /tmp/link-proof`',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expansion tests quoting against injection
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

describe('posixShellQuote', () => {
  it('leaves ordinary URLs and IDs unquoted', () => {
    expect(posixShellQuote('https://merchant.example/pay')).toBe(
      'https://merchant.example/pay',
    );
    expect(posixShellQuote('sr_123abc')).toBe('sr_123abc');
    expect(posixShellQuote('POST')).toBe('POST');
  });

  it('quotes an empty string so it survives as an argument', () => {
    expect(posixShellQuote('')).toBe("''");
  });

  it('quotes values carrying shell metacharacters', () => {
    for (const payload of PAYLOADS) {
      const quoted = posixShellQuote(payload);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });

  it('escapes embedded single quotes rather than closing the quote', () => {
    expect(posixShellQuote("a'b")).toBe(`'a'\\''b'`);
  });

  // The assertion that actually proves the encoder: hand the quoted value to a
  // real shell and require the byte-for-byte original back.
  itPosix.each(PAYLOADS)('round-trips through bash: %j', (payload) => {
    const out = execFileSync(
      'bash',
      ['-c', `printf %s ${posixShellQuote(payload)}`],
      { encoding: 'utf8' },
    );
    expect(out).toBe(payload);
  });

  itPosix('round-trips every argument of a multi-part command', () => {
    const args = ['pay', PAYLOADS[0], '-d', '{"a":"it\'s"}', '-H', 'X: a b'];
    const out = execFileSync(
      'bash',
      [
        '-c',
        `for a in ${posixShellCommand(args)}; do printf '%s\\n' "$a"; done`,
      ],
      { encoding: 'utf8' },
    );
    expect(out.split('\n').slice(0, args.length)).toEqual(args);
  });

  itPosix('does not execute a command substitution payload', () => {
    const out = execFileSync(
      'bash',
      ['-c', `printf %s ${posixShellQuote('$(echo pwned)')}`],
      { encoding: 'utf8' },
    );
    expect(out).toBe('$(echo pwned)');
    expect(out).not.toContain('pwned\n');
  });
});
