import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createValidationServer } from './seller.ts';
import { createSptAdapter } from './spt.ts';

const paid = {
  id: 'pi_test',
  status: 'succeeded',
  livemode: false,
  amount: 100,
  currency: 'usd',
};
const servers: Server[] = [];

async function start(stripeResponse: unknown) {
  const stripe = vi.fn<typeof fetch>(async () => Response.json(stripeResponse));
  const run = createValidationServer(
    createSptAdapter('sk_test_seller', stripe),
    () => {},
  );
  servers.push(run.server);
  await new Promise<void>((resolve) =>
    run.server.listen(0, '127.0.0.1', resolve),
  );
  const { port } = run.server.address() as AddressInfo;
  return { ...run, stripe, url: `http://127.0.0.1:${port}` };
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

it('passes after a verified payment and its confirmation', async () => {
  const run = await start(paid);
  expect(await fetch(`${run.url}/api`).then((r) => r.json())).toMatchObject({
    amount: 100,
    network_id: 'profile_test_seller',
  });
  const receipt = await post(`${run.url}/purchase`, {
    spt: 'spt_test_buyer',
  }).then((r) => r.json());

  const [, init] = run.stripe.mock.calls[0];
  expect(init?.headers).toMatchObject({
    'Idempotency-Key': `link_validate_${run.runId}`,
  });
  expect(Object.fromEntries(init?.body as URLSearchParams)).toMatchObject({
    amount: '100',
    currency: 'usd',
    shared_payment_granted_token: 'spt_test_buyer',
  });

  expect(
    (await post(`${run.url}/confirm`, { confirmation_token: 'wrong' })).status,
  ).toBe(400);
  await post(`${run.url}/confirm`, {
    confirmation_token: receipt.confirmation_token,
  });
  expect(await run.completed).toEqual({
    status: 'passed',
    run_id: run.runId,
    payment_intent: paid.id,
  });
});

it('fails the run on an unexpected payment and allows no second purchase', async () => {
  const run = await start({ ...paid, livemode: true });
  const response = await post(`${run.url}/purchase`, { spt: 'spt_test_buyer' });
  expect(response.status).toBe(422);
  expect(await response.json()).not.toHaveProperty('confirmation_token');
  expect(await run.completed).toMatchObject({ status: 'failed' });
  expect(
    (await post(`${run.url}/purchase`, { spt: 'spt_test_retry' })).status,
  ).toBe(409);
  expect(run.stripe).toHaveBeenCalledTimes(1);
});

it('never echoes seller keys or SPTs from Stripe errors', async () => {
  const run = await start({
    error: { message: 'sk_test_seller spt_test_buyer' },
  });
  const response = await post(`${run.url}/purchase`, { spt: 'spt_test_buyer' });
  expect(await response.text()).not.toMatch(/sk_test_seller|spt_test_buyer/);
});

it('rejects other origins and hosts before calling Stripe', async () => {
  const run = await start(paid);
  const origin = await post(
    `${run.url}/purchase`,
    { spt: 'spt_test_buyer' },
    { Origin: 'https://unrelated.test' },
  );
  expect(origin.status).toBe(403);
  // fetch() cannot override Host.
  const host = await new Promise((resolve) =>
    request(
      `${run.url}/api`,
      { headers: { Host: 'unrelated.test' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    ).end(),
  );
  expect(host).toBe(403);
  expect(run.stripe).not.toHaveBeenCalled();
});

it('requires a sandbox key that can accept SPTs', () => {
  expect(() => createSptAdapter('sk_live_seller')).toThrow('sandbox key');
  expect(() => createSptAdapter('rkcs_test_claimable')).toThrow('sandbox key');
});
