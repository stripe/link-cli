import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createValidationServer } from '../../src/seller.ts';
import { createSptAdapter } from '../../src/spt.ts';
import { validations } from '../../src/validations/index.ts';

const [cardWebmcpPurchase] = validations.filter(
  (v) => v.id === 'card-webmcp-purchase',
);

const servers: Server[] = [];

async function start() {
  const stripe = vi.fn<typeof fetch>();
  const run = createValidationServer(
    createSptAdapter('sk_test_seller', stripe),
    [cardWebmcpPurchase],
    () => {},
  );
  servers.push(run.server);
  await new Promise<void>((resolve) =>
    run.server.listen(0, '127.0.0.1', resolve),
  );
  const { port } = run.server.address() as AddressInfo;
  return {
    ...run,
    stripe,
    url: `http://127.0.0.1:${port}/card-webmcp-purchase`,
  };
}

const address = {
  line_1: '123 Main St',
  locality: 'Springfield',
  administrative_area: 'IL',
  postal_code: '62701',
  country_code: 'US',
};
const validForm = {
  name: 'Jamie Rivers',
  card_number: '4242 4242 4242 4242',
  expiry: '12/39',
  cvc: '123',
  ...address,
};
const post = (url: string, form: Record<string, string>, headers = {}) =>
  fetch(`${url}/purchase`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form),
  });

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

it('requires the WebMCP checkout form submission', async () => {
  const run = await start();
  const html = await fetch(run.url).then((r) => r.text());
  expect(html).toContain("form.setAttribute('toolname', 'purchase')");
  expect(html).toContain(
    `form.setAttribute('tooldescription', "Trail water bottle, $1.00 USD, shipped. Place a test order using test-mode card credentials (Link CLI: --test) and a shipping address. No charge will be made.")`,
  );
  expect(run.observe('card-webmcp-purchase').api_viewed).toBe(true);

  const response = await post(run.url, validForm);
  expect(response.status).toBe(400);
  expect(run.observe('card-webmcp-purchase').confirmed).toBe(false);
  expect(run.stripe).not.toHaveBeenCalled();
});

it('completes card checkout without charging and checks the shipping address', async () => {
  const run = await start();
  const response = await post(run.url, validForm, {
    'X-WebMCP-Tool': 'purchase',
  });
  expect(response.status).toBe(200);
  const observed = run.observe('card-webmcp-purchase');
  expect(observed).toMatchObject({
    confirmed: true,
    payment: { card_last4: '4242' },
    shipping_address: address,
  });
  expect(JSON.stringify(observed)).not.toContain(validForm.card_number);
  const link = async () => [{ is_default: true, address }];
  expect(
    await cardWebmcpPurchase.evaluate({ observed, link, since: 0 }, false),
  ).toMatchObject({
    status: 'passed',
    shipping: 'passed',
    card_last4: '4242',
  });
  expect(run.stripe).not.toHaveBeenCalled();
});
