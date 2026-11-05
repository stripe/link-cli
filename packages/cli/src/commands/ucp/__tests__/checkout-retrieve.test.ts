import type {
  ISpendRequestResource,
  IUcpResource,
  SpendRequest,
  UcpCheckout,
} from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createUcpCli } from '..';

const checkout: UcpCheckout = {
  id: 'dcs_1',
  status: 'completed',
  messages: [{ content: 'Review order' }],
};
const spendRequest: SpendRequest = {
  id: 'lsrq_1',
  status: 'requires_action',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
  shared_payment_token: { id: 'sensitive-token' },
  status_details: {
    requires_action: {
      next_action: {
        type: 'three_d_secure',
        resolution: 'auto_resume',
        display_message: 'Private action message',
        action_url: 'https://example.com/private-action',
      },
    },
  },
};

async function retrieve(
  retrieveCheckout: IUcpResource['retrieveCheckout'],
  tty: boolean,
  flags: string[] = [],
  spendRequests: Pick<ISpendRequestResource, 'retrieve'> = {
    retrieve: vi.fn(async () => spendRequest),
  },
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
      cancelCheckout: vi.fn(),
      updateCheckout: vi.fn(),
      retrieveCheckout,
    };
    const cli = createUcpCli(
      () => repository,
      undefined,
      'test-access-token',
      () => spendRequests,
    );
    let output = '';
    const exit = vi.fn();
    await cli.serve(
      [
        'checkout',
        'retrieve',
        'dcs_1',
        '--spend-request-id',
        'lsrq_1',
        '--business',
        'np_1',
        ...flags,
      ],
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
    if (originalTty)
      Object.defineProperty(process.stdout, 'isTTY', originalTty);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
  }
}
function expectNoPaymentDetails(output: string) {
  expect(output).not.toMatch(
    /spend_request|lsrq_1|sensitive-token|Private action|private-action|three_d_secure|auto_resume|status_details/,
  );
}

describe('ucp checkout retrieve output', () => {
  it('prints checkout only when piped, without fetching payment', async () => {
    const retrieveCheckout = vi.fn(async () => checkout);
    const spendRequests = { retrieve: vi.fn(async () => spendRequest) };
    const output = await retrieve(retrieveCheckout, false, [], spendRequests);
    expect(retrieveCheckout).toHaveBeenCalledExactlyOnceWith('dcs_1', {
      business: 'np_1',
    });
    expect(spendRequests.retrieve).not.toHaveBeenCalled();
    expect(output).toContain('dcs_1');
    expectNoPaymentDetails(output);
  });
  it.each([true, false])(
    'returns only checkout JSON (TTY: %s)',
    async (tty) => {
      const output = await retrieve(
        vi.fn(async () => checkout),
        tty,
        ['--format', 'json'],
      );
      expect(JSON.parse(output)).toEqual(checkout);
      expectNoPaymentDetails(output);
    },
  );
  it.each([{ format: [] }, { format: ['--format', 'json'] }])(
    'returns polling updates without spend-request fields (%j)',
    async ({ format }) => {
      const retrieveCheckout = vi.fn(async () => checkout);
      const spendRequests = {
        retrieve: vi
          .fn()
          .mockResolvedValueOnce({ ...spendRequest, status: 'approved' })
          .mockResolvedValueOnce({ ...spendRequest, status: 'succeeded' }),
      };
      const output = await retrieve(
        retrieveCheckout,
        false,
        ['--poll', ...format],
        spendRequests,
      );
      expect(retrieveCheckout).toHaveBeenCalledTimes(2);
      expect(spendRequests.retrieve).toHaveBeenCalledTimes(2);
      expect(output).toContain('pending');
      expect(output).toContain('success');
      expect(output).toContain('dcs_1');
      expectNoPaymentDetails(output);
    },
  );
  it('stops at a payment action and returns a generic outcome with checkout only', async () => {
    const output = await retrieve(
      vi.fn(async () => checkout),
      false,
      ['--poll', '--format', 'json'],
    );
    expect(JSON.parse(output)).toEqual([
      {
        outcome: 'action_required',
        reason: 'payment_action_required',
        checkout,
      },
    ]);
    expectNoPaymentDetails(output);
  });
});
