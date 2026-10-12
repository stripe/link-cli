import { describe, expect, it } from 'vitest';
import { upgradeCommand } from '../upgrade-command';

describe('upgradeCommand', () => {
  it('renders Windows remediation arguments as data without shell quoting', () => {
    const action = 'inspect" & echo %LINK_ACCESS_TOKEN% !LINK_REFRESH_TOKEN!';
    const result = upgradeCommand(
      [{ authorization_details: [{ type: 'custom', actions: [action] }] }],
      'win32',
    );
    const prefix = 'Link CLI arguments (invoke without a shell): ';
    expect(result?.startsWith(prefix)).toBe(true);
    expect(JSON.parse(result?.slice(prefix.length) ?? '')).toEqual({
      command: 'auth',
      args: [
        'upgrade',
        '--authorization-detail',
        JSON.stringify({ type: 'custom', actions: [action] }),
      ],
    });
  });
  it('unions scopes and actions across remediations', () => {
    expect(
      upgradeCommand(
        [
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
                actions: [
                  'read_link_transactions',
                  'read_external_transactions',
                ],
              },
              { type: 'custom', actions: ['inspect'] },
            ],
          },
        ],
        'linux',
      ),
    ).toBe(
      'link-cli auth upgrade --scope \'userinfo:read payment_methods.agentic\' --source-actions read_link_transactions --source-actions read_external_transactions --authorization-detail \'{"type":"custom","actions":["inspect"]}\'',
    );
  });

  it('quotes arbitrary remediation values and omits empty remediations', () => {
    expect(upgradeCommand([null, undefined, {}], 'linux')).toBeNull();
    expect(
      upgradeCommand(
        [
          {
            authorization_details: [
              {
                type: 'source',
                actions: ['read_link_transactions; echo unsafe'],
              },
            ],
          },
        ],
        'linux',
      ),
    ).toBe(
      'link-cli auth upgrade --authorization-detail \'{"type":"source","actions":["read_link_transactions; echo unsafe"]}\'',
    );
  });
});
