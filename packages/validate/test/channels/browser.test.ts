import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createValidationServer } from '../../src/seller.ts';
import { createSptAdapter } from '../../src/spt.ts';
import { validations } from '../../src/validations/index.ts';

const [cardBrowserPurchase] = validations.filter(
  (v) => v.id === 'card-browser-purchase',
);

const servers: Server[] = [];

async function start() {
  const stripe = vi.fn<typeof fetch>();
  const run = createValidationServer(
    createSptAdapter('sk_test_seller', stripe),
    [cardBrowserPurchase],
    () => {},
  );
  servers.push(run.server);
  await new Promise<void>((resolve) =>
    run.server.listen(0, '127.0.0.1', resolve),
  );
  const { port } = run.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/card-browser-purchase`;
  return { ...run, stripe, url };
}

const validForm = {
  name: 'Jamie Rivers',
  card_number: '4242 4242 4242 4242',
  expiry: '12/39',
  cvc: '123',
  line_1: '123 Main St',
  locality: 'Springfield',
  administrative_area: 'IL',
  postal_code: '62701',
  country_code: 'US',
};

const postForm = (url: string, data: Record<string, string>) =>
  fetch(url, { method: 'POST', body: new URLSearchParams(data) });

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

it('serves a checkout form and rejects a malformed card', async () => {
  const run = await start();
  const page = await fetch(`${run.url}/`).then((r) => r.text());
  expect(page).toContain('action="/card-browser-purchase/purchase"');
  expect(page).toContain('cc-number');
  expect(page).toContain('$1.00 USD');
  expect(page).toContain('Use test-mode card credentials only');
  expect(page).toContain('--test');
  expect(page).toContain('No charge will be made.');

  const response = await postForm(`${run.url}/purchase`, {
    ...validForm,
    expiry: '13/39',
  });
  expect(response.status).toBe(400);
  expect(run.stripe).not.toHaveBeenCalled();
});

it('accepts a well-formed card submission without calling Stripe', async () => {
  const run = await start();
  const response = await postForm(`${run.url}/purchase`, validForm);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('4242 4242 4242 4242');
  expect(run.observe('card-browser-purchase')).toMatchObject({
    confirmed: true,
    payment: { card_last4: '4242' },
  });
  expect(run.stripe).not.toHaveBeenCalled();
});

it('rejects an oversized form before it finishes uploading and keeps serving', async () => {
  const run = await start();
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      `${run.url}/purchase`,
      { method: 'POST' },
      (response) => {
        response.resume();
        request.end();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.setTimeout(1000, () =>
      request.destroy(new Error('No rejection response')),
    );
    // Keep the upload open: rejecting it must not destroy the response socket.
    request.write(
      new URLSearchParams({ ...validForm, name: 'x'.repeat(8193) }).toString(),
    );
  });
  expect(status).toBe(400);
  expect(run.observe('card-browser-purchase').confirmed).toBe(false);
  expect((await postForm(`${run.url}/purchase`, validForm)).status).toBe(200);
  expect(run.stripe).not.toHaveBeenCalled();
});
