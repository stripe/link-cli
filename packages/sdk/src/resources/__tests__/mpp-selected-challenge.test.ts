import { Challenge } from 'mppx';
import { expect, it, vi } from 'vitest';
import type { ISpendRequestResource } from '@/resources/interfaces';
import { MppResource } from '@/resources/mpp';

// Simulate mppx choosing a different supported offer from the one the SDK's
// resolver compared. The guard must reject it before credential creation.
vi.mock('mppx/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mppx/client')>();
  return {
    ...actual,
    Mppx: {
      ...actual.Mppx,
      create: (...args: Parameters<typeof actual.Mppx.create>) => ({
        ...actual.Mppx.create(...args),
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

it('rejects the challenge mppx selected when its order metadata differs', async () => {
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
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(refreshedResponse)
    .mockResolvedValueOnce(new Response('paid'));
  const retrieve = vi.fn().mockResolvedValue({
    id: 'lsrq_123',
    status: 'approved',
    credential_type: 'shared_payment_token',
    amount: 1000,
    currency: 'usd',
    network_id: 'net_001',
    shared_payment_token: { id: 'spt_test_123' },
  });

  await expect(
    new MppResource({ accessToken: 'test_token', fetch }, {
      retrieve,
    } as unknown as ISpendRequestResource).pay(
      { url: 'https://merchant.example/pay' },
      { spendRequestId: 'lsrq_123', approvedChallenge: approved },
    ),
  ).rejects.toThrow(/challenge changed after approval/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(refreshedResponse.bodyUsed).toBe(true);
});
