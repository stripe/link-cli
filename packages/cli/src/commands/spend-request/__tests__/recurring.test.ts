import { Link } from '@stripe/link-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSpendRequestCli } from '../index';

const request = {
  id: 'sr_recurring',
  status: 'approved',
  recurring: { interval: 'month', interval_count: 1 },
  created_at: '2026-10-16',
  updated_at: '2026-10-16',
};
const cardArgs = [
  '--merchant-name',
  'Example',
  '--merchant-url',
  'https://example.com',
];

function fixture() {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(request));
  const link = new Link({ accessToken: 'test-token', fetch });
  const cli = createSpendRequestCli(
    link.spendRequests,
    undefined,
    'test-token',
  );
  async function run(args: string[]) {
    let stdout = '';
    let exitCode = 0;
    await cli.serve([...args, '--format', 'json'], {
      stdout: (text) => {
        stdout += text;
      },
      exit: (code) => {
        exitCode = code;
      },
    });
    return { stdout, exitCode };
  }
  const createArgs = [
    'create',
    '--amount',
    '2000',
    '--context',
    'Monthly access to Example Pro requested by the user, with a spending limit of $20 per month including all taxes.',
  ];
  return { fetch, run, createArgs };
}

describe('recurring spend requests', () => {
  it.each([
    ['card', cardArgs],
    ['shared_payment_token', ['--network-id', 'net_example']],
    ['link_pay_token', ['--merchant-account-id', 'acct_example']],
  ] as const)(
    'creates recurring %s requests and returns after approval',
    async (credentialType, targeting) => {
      const { fetch, run, createArgs } = fixture();
      const result = await run([
        ...createArgs,
        '--credential-type',
        credentialType,
        ...targeting,
        '--recurring-interval',
        'month',
      ]);
      expect(result.exitCode).toBe(0);
      expect(fetch).toHaveBeenCalledOnce();
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(body).toMatchObject({
        credential_type: credentialType,
        request_approval: true,
        recurring: { interval: 'month' },
      });
      expect(body.recurring).not.toHaveProperty('interval_count');
      expect(result.stdout).toContain('approved');
      expect(result.stdout).not.toContain('_next');
    },
  );

  it.each([
    ['--recurring-interval-count', '2'],
    ['--recurring-interval', 'month', '--recurring-interval-count', '0'],
    ['--recurring-interval', 'month', '--recurring-interval-count', '-1'],
    ['--recurring-interval', 'month', '--recurring-interval-count', '1.5'],
  ])(
    'rejects invalid recurring flags before calling the API: %j',
    async (...flags) => {
      const { fetch, run, createArgs } = fixture();
      const result = await run([...createArgs, ...cardArgs, ...flags]);
      expect(result.exitCode).toBe(1);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('retrieves and cancels an approved recurring request without polling for payment completion', async () => {
    const { fetch, run } = fixture();
    expect(
      (await run(['retrieve', request.id, '--interval', '2'])).exitCode,
    ).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValueOnce(
      Response.json({ ...request, status: 'canceled' }),
    );
    const result = await run(['cancel', request.id]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('canceled');
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `https://api.link.com/spend_requests/${request.id}/cancel`,
    );
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
  });
});
