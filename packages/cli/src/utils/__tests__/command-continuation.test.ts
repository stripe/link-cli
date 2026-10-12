import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildCommandContinuation,
  formatCommandSuggestion,
} from '../command-continuation';

const ARGS = [
  'pay',
  'https://seller.example/pay?a=1&b=2',
  '',
  'a\'b"c\\',
  '& | < > ^ ( )',
  '%LINK_ACCESS_TOKEN%',
  '!LINK_REFRESH_TOKEN!',
  '$(echo unsafe)',
  'a\nb\tc',
];

describe('buildCommandContinuation', () => {
  it.each<NodeJS.Platform>(['win32', 'linux', 'darwin'])(
    'preserves every argument on %s',
    (platform) => {
      const result = buildCommandContinuation('mpp', ARGS, platform);
      expect(result.argv).toEqual({ command: 'mpp', args: ARGS });
      expect(result.argv.args).not.toBe(ARGS);
      if (platform === 'win32') {
        expect(result).toEqual({ argv: { command: 'mpp', args: ARGS } });
        expect(result).not.toHaveProperty('command');
        expect(result).not.toHaveProperty('shell');
      } else {
        expect(result.command).toContain(
          "'https://seller.example/pay?a=1&b=2'",
        );
        expect(result.shell).toBe('posix');
      }
    },
  );

  it('round-trips arguments through a real process without a shell', () => {
    const { argv } = buildCommandContinuation('mpp', ARGS, 'win32');
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        '--',
        argv.command,
        ...argv.args,
      ],
      { encoding: 'utf8', shell: false },
    );
    expect(JSON.parse(output)).toEqual([argv.command, ...ARGS]);
  });

  it('renders Windows suggestions as labeled JSON data', () => {
    const continuation = buildCommandContinuation('ucp', ARGS, 'win32');
    const suggestion = formatCommandSuggestion(continuation);
    const prefix = 'Link CLI arguments (invoke without a shell): ';
    expect(suggestion.startsWith(prefix)).toBe(true);
    expect(JSON.parse(suggestion.slice(prefix.length))).toEqual(
      continuation.argv,
    );
  });

  it('retains readable POSIX suggestions with quoted placeholders', () => {
    expect(
      formatCommandSuggestion(
        buildCommandContinuation(
          'ucp',
          [
            'checkout',
            'complete',
            'dcs_1',
            '--spend-request-id',
            '<spend_request_id>',
          ],
          'linux',
        ),
      ),
    ).toBe(
      "ucp checkout complete dcs_1 --spend-request-id '<spend_request_id>'",
    );
  });
});
