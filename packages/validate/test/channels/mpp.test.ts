import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Challenge, Credential } from 'mppx';
import { afterEach, expect, it, vi } from 'vitest';
import { createValidationServer } from '../../src/seller.ts';
import { createSptAdapter } from '../../src/spt.ts';
import { validations } from '../../src/validations/index.ts';

const [sptMppPurchase] = validations.filter((v) => v.id === 'spt-mpp-purchase');

const servers: Server[] = [];

async function start(stripeResponse: unknown) {
  const stripe = vi.fn<typeof fetch>(async () => Response.json(stripeResponse));
  const run = createValidationServer(
    createSptAdapter('sk_test_seller', stripe),
    [sptMppPurchase],
    () => {},
  );
  servers.push(run.server);
  await new Promise<void>((resolve) =>
    run.server.listen(0, '127.0.0.1', resolve),
  );
  const { port } = run.server.address() as AddressInfo;
  return { ...run, stripe, url: `http://127.0.0.1:${port}/spt-mpp-purchase` };
}

// Answers the 402 challenge with an SPT, as `link-cli mpp pay` does.
async function pay(url: string) {
  const probe = await fetch(url);
  expect(probe.status).toBe(402);
  expect(await probe.json()).toMatchObject({ test_mode: true });
  const [challenge] = Challenge.deserializeList(
    probe.headers.get('www-authenticate') ?? '',
  );
  expect(challenge.request).toMatchObject({
    amount: '100',
    currency: 'usd',
    description: expect.stringContaining('--test'),
    methodDetails: { networkId: 'profile_test_seller' },
  });
  return fetch(url, {
    headers: {
      Authorization: Credential.serialize({
        challenge,
        payload: { spt: 'spt_test_buyer' },
      }),
    },
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

it('charges a paid credential after a 402 challenge', async () => {
  const run = await start({
    id: 'pi_mpp',
    status: 'succeeded',
    livemode: false,
    amount: 100,
    currency: 'usd',
  });
  const response = await pay(run.url);
  expect(response.status).toBe(200);
  expect(response.headers.get('payment-receipt')).toBeTruthy();
  const [, options] = run.stripe.mock.calls[0];
  expect(options?.headers).toMatchObject({
    Authorization: 'Bearer sk_test_seller',
  });
  expect(new URLSearchParams(options?.body as string).get('amount')).toBe(
    '100',
  );
  expect(run.observe('spt-mpp-purchase')).toMatchObject({
    api_viewed: true,
    payment: { payment_intent: 'pi_mpp' },
  });
  expect((await fetch(run.url)).status).toBe(409);
});

it('ends the validation on a rejected payment without echoing secrets', async () => {
  const run = await start({
    error: { message: 'sk_test_seller spt_test_buyer' },
  });
  const response = await pay(run.url);
  expect(response.status).toBe(422);
  expect(await response.text()).not.toMatch(/sk_test_seller|spt_test_buyer/);
  expect(run.observe('spt-mpp-purchase').terminal_error).toBeDefined();
  expect((await fetch(run.url)).status).toBe(409);
});
