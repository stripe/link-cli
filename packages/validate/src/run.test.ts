import { expect, it, vi } from 'vitest';
import type { LinkCli } from './link.ts';
import { runValidation } from './run.ts';
import { createSptAdapter } from './spt.ts';

type Event = { event?: string; [key: string]: unknown };
type Result = { id: string; status: string; [key: string]: unknown };

const address = { line_1: '123 Main St', country_code: 'US' };

function run(timeoutMs: number, link: LinkCli) {
  const events: Event[] = [];
  let ready!: (event: Event) => void;
  const readyEvent = new Promise<Event>((resolve) => {
    ready = resolve;
  });
  const stripe = vi.fn<typeof fetch>(async () =>
    Response.json({
      id: 'pi_test',
      status: 'succeeded',
      livemode: false,
      amount: 100,
      currency: 'usd',
    }),
  );
  const exit = runValidation({
    adapter: createSptAdapter('sk_test_seller', stripe),
    port: 0,
    timeoutMs,
    signal: new AbortController().signal,
    write: (event: Event) => {
      events.push(event);
      if (event.event === 'ready') ready(event);
    },
    log: () => {},
    link,
    pollMs: 10,
    graceMs: 30,
  });
  const results = () =>
    Object.fromEntries(
      ((events.at(-1)?.validations ?? []) as Result[]).map((r) => [r.id, r]),
    );
  return { events, readyEvent, exit, results };
}

// Pays for and confirms the first task's purchase.
async function buy(ready: Event, shipping_address = address) {
  const url = (ready.tasks as { url: string }[])[0].url;
  const post = (path: string, body: unknown) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const receipt = await post('/purchase', {
    spt: 'spt_test_buyer',
    shipping_address,
  });
  await post('/confirm', { confirmation_token: receipt.confirmation_token });
}

const link =
  (spendRequests: unknown[]): LinkCli =>
  async (args) =>
    args[0] === 'shipping-address'
      ? [{ is_default: true, address }]
      : spendRequests;
// The cancel validation's spend request, as Link reports it.
const fieldGuide = {
  network_id: 'profile_test_seller',
  amount: 200,
  created_at: new Date().toISOString(),
  status: 'pending_approval',
};

it('passes when the buyer ships to the default address and cancels', async () => {
  const request = { ...fieldGuide };
  const validation = run(0, link([request]));
  const ready = await validation.readyEvent;
  // Case and whitespace differences from the Link address record still match.
  await buy(ready, { line_1: ' 123 MAIN ST ', country_code: 'us' });
  const cancelUrl = (ready.tasks as { url: string }[])[1].url;
  const refused = await fetch(`${cancelUrl}/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spt: 'spt_test_guide' }),
  });
  expect(await refused.json()).toEqual({
    error: 'We are out of stock. Your payment was not processed.',
  });
  request.status = 'canceled';
  expect(await validation.exit).toBe(0);
  expect(validation.results()).toMatchObject({
    'spt-purchase': { status: 'passed', shipping: 'passed' },
    'spt-cancel': { status: 'passed' },
  });
});

it('fails when the buyer ships elsewhere', async () => {
  const validation = run(0, link([fieldGuide]));
  await buy(await validation.readyEvent, {
    line_1: '456 Other St',
    country_code: 'US',
  });
  expect(await validation.exit).toBe(2);
  expect(validation.results()['spt-purchase']).toMatchObject({
    status: 'failed',
    shipping: 'failed',
  });
});

it('marks a validation unverified after the grace period', async () => {
  const validation = run(0, link([]));
  await buy(await validation.readyEvent);
  expect(await validation.exit).toBe(0);
  expect(validation.results()['spt-cancel']).toMatchObject({
    status: 'unverified',
  });
});

it('times out a validation that never finishes', async () => {
  const validation = run(20, async () => undefined);
  expect(await validation.exit).toBe(3);
  expect(validation.results()).toMatchObject({
    'spt-purchase': { status: 'timed_out' },
    'spt-cancel': { status: 'unverified' },
  });
});
