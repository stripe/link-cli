import { describe, expect, it } from 'vitest';
import { upgradeCommand } from '../upgrade-command';

describe('upgradeCommand', () => {
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
});
