import type { ISpendRequestResource } from '@stripe/link-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { payWithSpt, runMppPayFullFlow } from './pay';

const WWW_AUTHENTICATE_STRIPE = [
  'Payment id="ch_001",',
  'realm="merchant.example",',
  'method="stripe",',
  'intent="charge",',
  `request="${Buffer.from(JSON.stringify({ networkId: 'net_001', amount: '1000', currency: 'usd', decimals: 2, paymentMethodTypes: ['card'] })).toString('base64')}",`,
  'expires="2099-01-01T00:00:00Z"',
].join(' ');

function challengeResponse(): Response {
  return new Response('{"error":"payment required"}', {
    status: 402,
    headers: { 'www-authenticate': WWW_AUTHENTICATE_STRIPE },
  });
}

beforeEach(() => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payWithSpt', () => {
  it('replaces caller authorization and refuses a redirect after payment', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/payment' },
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      payWithSpt(
        'https://merchant.example/challenge',
        'spt_test_123',
        'POST',
        '{"item":"book"}',
        ['authorization: Bearer caller-value'],
      ),
    ).rejects.toThrow('redirect 307');

    const paidHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(
      [...paidHeaders].filter(([name]) => name === 'authorization'),
    ).toEqual([['authorization', expect.stringMatching(/^Payment /)]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('manual');
    expect(fetcher.mock.calls[1][1]?.body).toBe('{"item":"book"}');
  });

  it('refreshes an approved challenge at the pinned destination without following redirects', async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({
        id: 'lsrq_123',
        status: 'pending_approval',
      }),
      retrieve: vi
        .fn()
        .mockResolvedValueOnce({ id: 'lsrq_123', status: 'approved' })
        .mockResolvedValueOnce({
          id: 'lsrq_123',
          status: 'approved',
          shared_payment_token: { id: 'spt_test_123' },
        }),
    } as unknown as ISpendRequestResource;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://merchant.example/challenge' },
        }),
      )
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/challenge' },
        }),
      );
    vi.stubGlobal('fetch', fetcher);

    await expect(
      runMppPayFullFlow({
        url: 'https://redirector.example/start',
        method: 'GET',
        data: undefined,
        headers: undefined,
        context:
          'Buy a test item from the merchant after explicit Link approval for this machine payment request.',
        amountOverride: 1000,
        paymentMethodId: 'pd_test_123',
        test: true,
        repository,
        paymentMethodsFactory: vi.fn(),
      }),
    ).rejects.toThrow(/redirected with status 307 after approval/);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://redirector.example/start',
      'https://merchant.example/challenge',
      'https://merchant.example/challenge',
    ]);
  });
});
