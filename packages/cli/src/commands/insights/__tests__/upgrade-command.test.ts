import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { upgradeCommand } from '../upgrade-command';

describe('upgradeCommand', () => {
  it('uses the source-action flag for holdings remediation', () => {
    expect(
      upgradeCommand([
        {
          authorization_details: [
            { type: 'source', actions: ['read_holdings'] },
          ],
        },
      ]),
    ).toBe('link-cli auth upgrade --source-actions read_holdings');
  });

  it('unions scopes and actions across remediations', () => {
    expect(
      upgradeCommand([
        {
          scope: ['userinfo:read'],
          authorization_details: [
            { type: 'source', actions: ['read_link_transactions'] },
          ],
        },
        {
          scope: ['payment_methods.agentic', 'userinfo:read'],
          authorization_details: [
            {
              type: 'source',
              actions: ['read_link_transactions', 'read_external_transactions'],
            },
            { type: 'custom', actions: ['inspect'] },
          ],
        },
      ]),
    ).toBe(
      'link-cli auth upgrade --scope \'userinfo:read payment_methods.agentic\' --source-actions read_link_transactions --source-actions read_external_transactions --authorization-detail \'{"type":"custom","actions":["inspect"]}\'',
    );
  });

  it('quotes arbitrary remediation values and omits empty remediations', () => {
    expect(upgradeCommand([null, undefined, {}])).toBeNull();
    expect(
      upgradeCommand([
        {
          authorization_details: [
            {
              type: 'source',
              actions: ['read_link_transactions; echo unsafe'],
            },
          ],
        },
      ]),
    ).toBe(
      'link-cli auth upgrade --authorization-detail \'{"type":"source","actions":["read_link_transactions; echo unsafe"]}\'',
    );
  });
  it('can omit the executable for incur continuation commands', () => {
    expect(
      upgradeCommand(
        [
          {
            authorization_details: [
              { type: 'source', actions: ['read_holdings'] },
            ],
          },
        ],
        { includeExecutable: false },
      ),
    ).toBe('auth upgrade --source-actions read_holdings');
  });
  it.skipIf(process.platform === 'win32')(
    'round-trips hostile actions through the shell without execution',
    () => {
      const action = "read_holdings'; $(printf PWNED); echo '";
      const command = upgradeCommand(
        [{ authorization_details: [{ type: 'source', actions: [action] }] }],
        { includeExecutable: false },
      );
      const output = execFileSync(
        'bash',
        ['-c', `set -- ${command}; printf '%s\\0' "$@"`],
        { encoding: 'utf8' },
      );
      expect(output.split('\0').slice(0, -1)).toEqual([
        'auth',
        'upgrade',
        '--authorization-detail',
        JSON.stringify({ type: 'source', actions: [action] }),
      ]);
    },
  );
});
