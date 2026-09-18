import type {
  IUcpResource,
  UcpCheckoutWithSpendRequest,
} from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createUcpCli } from '..';

const checkout: UcpCheckoutWithSpendRequest = {
  id: 'dcs_1',
  status: 'requires_action',
  spend_request: {
    id: 'lsrq_1',
    status: 'requires_action',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:01Z',
    status_details: {
      requires_action: {
        next_action: {
          type: 'three_d_secure',
          resolution: 'auto_resume',
          display_message: 'Complete verification',
          action_url: 'https://example.com/action',
        },
      },
    },
  },
};

async function retrieve(
  retrieveCheckout: IUcpResource['retrieveCheckout'],
  tty: boolean,
  flags: string[] = [],
) {
  const originalTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: tty,
  });
  try {
    const repository: IUcpResource = {
      searchCatalog: vi.fn(),
      createCheckout: vi.fn(),
      completeCheckout: vi.fn(),
      retrieveCheckout,
    };
    const cli = createUcpCli(() => repository, undefined, 'test-access-token');
    let output = '';
    const exit = vi.fn();
    await cli.serve(
      ['checkout', 'retrieve', 'dcs_1', '--spend-request-id', 'lsrq_1', ...flags],
      {
        stdout: (chunk) => {
          output += chunk;
        },
        exit,
      },
    );
    expect(exit.mock.calls.every(([code]) => code === 0)).toBe(true);
    return output;
  } finally {
    if (originalTty) {
      Object.defineProperty(process.stdout, 'isTTY', originalTty);
    } else {
      Reflect.deleteProperty(process.stdout, 'isTTY');
    }
  }
}

describe('ucp checkout retrieve output', () => {
  it.each([true, false])(
    'prints checkout, spend request, and action details without a format flag (TTY: %s)',
    async (tty) => {
      const retrieveCheckout = vi.fn(async () => checkout);
      const output = await retrieve(retrieveCheckout, tty);

      expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('dcs_1', {
        spend_request_id: 'lsrq_1',
        test: undefined,
      });
      for (const value of [
        'dcs_1',
        'lsrq_1',
        'requires_action',
        'three_d_secure',
        'auto_resume',
        'Complete verification',
        'https://example.com/action',
      ]) {
        expect(output).toContain(value);
      }
    },
  );

  it.each([true, false])(
    'preserves the full JSON response (TTY: %s)',
    async (tty) => {
      const output = await retrieve(vi.fn(async () => checkout), tty, [
        '--format',
        'json',
      ]);

      expect(JSON.parse(output)).toEqual(checkout);
    },
  );

  it('prints polling updates and the final outcome in a terminal', async () => {
    const retrieveCheckout = vi
      .fn<IUcpResource['retrieveCheckout']>()
      .mockResolvedValueOnce({
        id: 'dcs_1',
        status: 'open',
        spend_request: { ...checkout.spend_request, status: 'approved' },
      })
      .mockResolvedValueOnce({
        id: 'dcs_1',
        status: 'completed',
        spend_request: { ...checkout.spend_request, status: 'succeeded' },
      });
    const output = await retrieve(retrieveCheckout, true, ['--poll']);

    expect(retrieveCheckout).toHaveBeenCalledTimes(2);
    expect(output).toContain('outcome: pending');
    expect(output).toContain('outcome: success');
    expect(output).toContain('checkout_completed_and_spend_request_succeeded');
    expect(output).toContain('dcs_1');
    expect(output).toContain('lsrq_1');
  });
});
