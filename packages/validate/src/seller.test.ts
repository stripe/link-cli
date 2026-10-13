import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createValidationServer } from './seller.ts';
import { createSptAdapter } from './spt.ts';
import { validations } from './validations/index.ts';

const paid = {
  id: 'pi_test',
  status: 'succeeded',
  livemode: false,
  amount: 100,
  currency: 'usd',
};
const shipping_address = { line_1: '123 Main St', country_code: 'US' };
const servers: Server[] = [];

async function start(stripeResponse: unknown) {
  const stripe = vi.fn<typeof fetch>(async () => Response.json(stripeResponse));
  const run = createValidationServer(
    createSptAdapter('sk_test_seller', stripe),
    validations,
    () => {},
  );
  servers.push(run.server);
  await new Promise<void>((resolve) =>
    run.server.listen(0, '127.0.0.1', resolve),
  );
  const { port } = run.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return { ...run, stripe, url, purchase: `${url}/spt-purchase` };
}

const post = (url: string, body: unknown, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

it('confirms a verified payment', async () => {
  const run = await start(paid);
  expect(
    await fetch(`${run.purchase}/api`).then((r) => r.json()),
  ).toMatchObject({
    product: { amount: 100, ships: true },
    network_id: 'profile_test_seller',
  });
  const receipt = await post(`${run.purchase}/purchase`, {
    spt: 'spt_test_buyer',
    shipping_address,
  }).then((r) => r.json());

  const [, init] = run.stripe.mock.calls[0];
  expect(init?.headers).toMatchObject({
    'Idempotency-Key': `link_validate_${run.runId}_spt-purchase`,
  });
  expect(Object.fromEntries(init?.body as URLSearchParams)).toMatchObject({
    amount: '100',
    currency: 'usd',
    shared_payment_granted_token: 'spt_test_buyer',
  });

  expect(
    (await post(`${run.purchase}/confirm`, { confirmation_token: 'wrong' }))
      .status,
  ).toBe(400);
  await post(`${run.purchase}/confirm`, {
    confirmation_token: receipt.confirmation_token,
  });
  expect(run.observe('spt-purchase')).toMatchObject({
    confirmed: true,
    payment: { payment_intent: paid.id },
    shipping_address,
  });
});

it('ends the validation on a rejected payment without echoing secrets', async () => {
  const run = await start({
    error: { message: 'sk_test_seller spt_test_buyer' },
  });
  const body = { spt: 'spt_test_buyer', shipping_address };
  const response = await post(`${run.purchase}/purchase`, body);
  expect(response.status).toBe(422);
  const text = await response.text();
  expect(text).not.toMatch(/sk_test_seller|spt_test_buyer|confirmation_token/);
  expect(run.observe('spt-purchase').terminal_error).toBeDefined();
  expect((await post(`${run.purchase}/purchase`, body)).status).toBe(409);
  expect(run.stripe).toHaveBeenCalledTimes(1);
});

it('requires shipping where the product ships and refuses out-of-stock products', async () => {
  const run = await start(paid);
  expect(
    (await post(`${run.purchase}/purchase`, { spt: 'spt_test_buyer' })).status,
  ).toBe(400);
  expect((await post(`${run.url}/spt-cancel/purchase`, {})).status).toBe(409);
  expect(run.observe('spt-cancel').purchase_attempted).toBe(true);
  expect(
    await fetch(`${run.url}/spt-cancel/api`).then((r) => r.json()),
  ).not.toHaveProperty('confirmation');
  expect(run.stripe).not.toHaveBeenCalled();
});

it('requires a sandbox key that can accept SPTs', () => {
  expect(() => createSptAdapter('sk_live_seller')).toThrow('sandbox key');
  expect(() => createSptAdapter('rkcs_test_claimable')).toThrow('sandbox key');
});
