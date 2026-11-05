import { Challenge } from 'mppx';
import { afterEach, expect, it, vi } from 'vitest';
import { payWithSpt } from './pay';

// Simulate mppx choosing a different supported offer from the one the CLI's
// resolver compared. The guard must reject it before credential creation.
vi.mock('mppx/client', async () => {
  const { Challenge } = await import('mppx');
  return {
    Mppx: {
      create: () => ({
        preparePayment: async (response: Response) => {
          const selected = Challenge.fromResponseList(response)[1];
          if (!selected) throw new Error('Expected a second challenge offer');
          return {
            challenge: selected,
            createCredential: () => {
              throw new Error(
                'Unapproved challenge reached credential creation',
              );
            },
          };
        },
      }),
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('rejects the challenge mppx selected when its order metadata differs', async () => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
  const request = {
    amount: '1000',
    currency: 'usd',
    decimals: 2,
    networkId: 'net_001',
    paymentMethodTypes: ['card'],
  };
  const approved = Challenge.serialize({
    id: 'ch_approved',
    realm: 'merchant.example',
    method: 'stripe',
    intent: 'charge',
    request,
    meta: { order: 'order_A' },
  });
  const otherOrder = Challenge.serialize({
    id: 'ch_other',
    realm: 'merchant.example',
    method: 'stripe',
    intent: 'charge',
    request,
    meta: { order: 'order_B' },
  });
  const refreshedResponse = new Response('payment required', {
    status: 402,
    headers: { 'www-authenticate': `${approved}, ${otherOrder}` },
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(refreshedResponse)
    .mockResolvedValueOnce(new Response('paid'));
  vi.stubGlobal('fetch', fetcher);

  await expect(
    payWithSpt(
      'https://merchant.example/pay',
      'spt_test_123',
      'GET',
      undefined,
      undefined,
      approved,
    ),
  ).rejects.toThrow(/challenge changed after approval/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(refreshedResponse.bodyUsed).toBe(true);
});
