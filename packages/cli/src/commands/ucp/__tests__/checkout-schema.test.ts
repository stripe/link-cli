import type { IUcpResource } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createUcpCli } from '..';

async function run(args: string[]) {
  const checkout = {
    id: 'checkout_1',
    status: 'ready_for_complete',
    currency: 'usd',
    totals: [{ type: 'total', amount: 5500 }],
    messages: [],
    ucp: { version: '2026-01-23' },
  };
  const repository: IUcpResource = {
    searchCatalog: vi.fn(),
    createCheckout: vi.fn(async () => checkout),
    updateCheckout: vi.fn(async () => checkout),
    completeCheckout: vi.fn(),
    retrieveCheckout: vi.fn().mockResolvedValue(checkout),
  };
  let output = '';
  const exit = vi.fn();
  await createUcpCli(() => repository, undefined, 'test-token').serve(
    ['checkout', ...args, '--format', 'json'],
    {
      stdout: (chunk) => {
        output += chunk;
      },
      exit,
    },
  );
  return { repository, checkout, output: JSON.parse(output), exit };
}

describe('UCP checkout schema', () => {
  it.each(['--fulfillment', '--fullfilment'])(
    'creates checkout with buyer fields, default quantities, and complete JSON via %s',
    async (flag) => {
      const fulfillment = {
        methods: [
          {
            id: 'shipping',
            type: 'shipping',
            destinations: [{ id: 'home', street_address: '123 Main St' }],
            selected_destination_id: 'home',
            groups: [{ id: 'group_1', selected_option_id: 'express' }],
          },
        ],
      };
      const { repository, checkout, output } = await run([
        'create',
        '--business',
        'np_1',
        '--line-item',
        'id:sku_1',
        '--line-item',
        'id:sku_2,quantity:2',
        '--buyer',
        'first_name:Jane,last_name:Doe,email:jane@example.com,phone:+1234567890',
        flag,
        JSON.stringify(fulfillment),
      ]);
      expect(repository.createCheckout).toHaveBeenCalledExactlyOnceWith({
        business: 'np_1',
        line_items: [
          { item: { id: 'sku_1' }, quantity: 1 },
          { item: { id: 'sku_2' }, quantity: 2 },
        ],
        buyer: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com',
          phone_number: '+1234567890',
        },
        fulfillment,
      });
      expect(output).toMatchObject(checkout);
      expect(output._next.argv.args).toContain('--spend-request-id');
      expect(output._next.argv.args).not.toContain('--complete');
    },
  );

  it('updates the supplied state without a preliminary retrieve or default sections', async () => {
    const { repository, checkout, output } = await run([
      'update',
      '--id',
      'checkout_1',
      '--business',
      'np_1',
      '--line-item',
      'id:sku_1',
    ]);
    expect(repository.updateCheckout).toHaveBeenCalledExactlyOnceWith(
      'checkout_1',
      {
        business: 'np_1',
        line_items: [{ item: { id: 'sku_1' }, quantity: 1 }],
      },
    );
    expect(repository.retrieveCheckout).not.toHaveBeenCalled();
    expect(output).toEqual(checkout);
  });

  it('uses the same buyer and fulfillment parsing for a positional update', async () => {
    const { repository } = await run([
      'update',
      'checkout_1',
      '--business',
      'np_1',
      '--line-item',
      'id:sku_1,quantity:3',
      '--buyer',
      'email:jane@example.com',
      '--fulfillment',
      '{}',
    ]);
    expect(repository.updateCheckout).toHaveBeenCalledExactlyOnceWith(
      'checkout_1',
      {
        business: 'np_1',
        line_items: [{ item: { id: 'sku_1' }, quantity: 3 }],
        buyer: { email: 'jane@example.com' },
        fulfillment: {},
      },
    );
  });

  it('retrieves before payment with --id and business', async () => {
    const { repository } = await run([
      'retrieve',
      '--id',
      'checkout_1',
      '--business',
      'np_1',
    ]);
    expect(repository.retrieveCheckout).toHaveBeenCalledExactlyOnceWith(
      'checkout_1',
      { business: 'np_1' },
    );
  });

  it.each([
    ['--line-item', 'id:sku_1,quantity:0'],
    ['--line-item', 'id:sku_1,quantity:1.5'],
    ['--line-item', 'id:sku_1,quantity:2147483648'],
    ['--line-item', 'id:sku_1,quantity:'],
    ['--line-item', 'id:sku_1,quanity:2'],
    ['--line-item', 'id:'],
    ['--line-item', 'sku_id:sku_1'],
    ['--buyer', 'emali:jane@example.com'],
    ['--fulfillment', '{invalid'],
    ['--fulfillment', 'null'],
    ['--fulfillment', '[]'],
    ['--fulfillment', '"shipping"'],
    ['--fulfillment', '{}', '--fullfilment', '{}'],
    ['--destination', 'street:123 Main St'],
    ['--fulfillment-option', 'express'],
    ['--fulfillment-details', '{}'],
    ['--payment-handler', 'stripe_payments'],
    ['--complete'],
    ['--currency', 'usd'],
    ['--test'],
  ])(
    'rejects invalid or unsupported input before creating a checkout: %j',
    async (...flags) => {
      const { repository, output } = await run([
        'create',
        '--business',
        'np_1',
        ...(flags[0] === '--line-item' ? [] : ['--line-item', 'id:sku_1']),
        ...flags,
      ]);
      expect(repository.createCheckout).not.toHaveBeenCalled();
      expect(output.code).toBeDefined();
    },
  );

  it.each([
    ['update', 'checkout_1', '--business', 'np_1'],
    ['update', '--business', 'np_1', '--line-item', 'id:sku_1'],
    ['retrieve', 'checkout_1'],
    ['retrieve', 'checkout_1', '--id', 'other', '--business', 'np_1'],
    ['retrieve', '--id', 'checkout_1', '--business', 'np_1', '--poll'],
  ])(
    'rejects missing state or conflicting checkout identifiers: %j',
    async (...args) => {
      const { repository, output } = await run(args);
      expect(repository.updateCheckout).not.toHaveBeenCalled();
      expect(repository.retrieveCheckout).not.toHaveBeenCalled();
      expect(output.code).toBeDefined();
    },
  );
});
