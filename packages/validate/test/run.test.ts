import { expect, it, vi } from 'vitest';
import type { LinkCli } from '../src/link.ts';
import { runValidation } from '../src/run.ts';
import { createSptAdapter } from '../src/spt.ts';
import { validations } from '../src/validations/index.ts';

type Task = { validation: string; url: string; task: string };
type Event = { event?: string; tasks?: Task[]; [key: string]: unknown };
type Result = { id: string; status: string; [key: string]: unknown };

const address = { line_1: '123 Main St', country_code: 'US' };
const [purchase] = validations.filter((v) => v.id === 'spt-api-purchase');
const [cancel] = validations.filter((v) => v.id === 'spt-api-cancel');

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
    validations: [purchase, cancel],
    link,
    pollMs: 10,
  });
  const results = () =>
    Object.fromEntries(
      ((events.at(-1)?.validations ?? []) as Result[]).map((r) => [r.id, r]),
    );
  return { events, readyEvent, exit, results };
}

// Pays for and confirms the API purchase task.
async function buy(ready: Event, shipping_address = address) {
  const url = ready.tasks?.find((task) => task.validation === purchase.id)?.url;
  expect(url).toBeDefined();
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

it('reports incremental scores when tasks finish out of order', async () => {
  const request = { ...fieldGuide };
  const validation = run(0, link([request]));
  const ready = await validation.readyEvent;
  for (const task of ready.tasks ?? []) {
    expect(task.task).toContain('Use test-mode payment credentials only');
    expect(task.task).toContain('--test');
  }
  const cancelUrl = ready.tasks?.find(
    (task) => task.validation === cancel.id,
  )?.url;
  expect(cancelUrl).toBeDefined();
  const refused = await fetch(`${cancelUrl}/purchase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spt: 'spt_test_guide' }),
  });
  expect(await refused.json()).toEqual({
    error: 'We are out of stock. Your payment was not processed.',
  });
  request.status = 'canceled';
  await vi.waitFor(() => {
    expect(validation.events).toContainEqual(
      expect.objectContaining({
        event: 'validation',
        validation: cancel.id,
        status: 'passed',
        score: { passed: 1, total: 2 },
      }),
    );
  });
  // Case and whitespace differences from the Link address record still match.
  await buy(ready, { line_1: ' 123 MAIN ST ', country_code: 'us' });
  expect(await validation.exit).toBe(0);
  expect(validation.events.at(-1)).toMatchObject({
    score: { passed: 2, total: 2 },
  });
  expect(validation.results()).toMatchObject({
    'spt-api-purchase': { status: 'passed', shipping: 'passed' },
    'spt-api-cancel': { status: 'passed' },
  });
});

it('fails when the buyer ships elsewhere', async () => {
  const validation = run(300, link([fieldGuide]));
  await buy(await validation.readyEvent, {
    line_1: '456 Other St',
    country_code: 'US',
  });
  expect(await validation.exit).toBe(2);
  expect(validation.events.at(-1)).toMatchObject({
    score: { passed: 0, total: 2 },
  });
  expect(validation.results()['spt-api-purchase']).toMatchObject({
    status: 'failed',
    shipping: 'failed',
  });
});

it('leaves unfinished cases pending until the overall deadline', async () => {
  const validation = run(300, link([]));
  await buy(await validation.readyEvent);
  await vi.waitFor(() => {
    expect(validation.events).toContainEqual(
      expect.objectContaining({
        event: 'validation',
        validation: purchase.id,
        status: 'passed',
        score: { passed: 1, total: 2 },
      }),
    );
  });
  expect(validation.events.some((event) => event.event === 'result')).toBe(
    false,
  );
  expect(await validation.exit).toBe(0);
  expect(validation.events.at(-1)).toMatchObject({
    score: { passed: 1, total: 2 },
  });
  expect(validation.results()['spt-api-cancel']).toMatchObject({
    status: 'unverified',
  });
});

it("approves this run's pending test spend requests once", async () => {
  const created_at = new Date().toISOString();
  const requests: Record<string, unknown>[] = [
    { ...fieldGuide, id: 'lsrq_spt' },
    { ...fieldGuide, id: 'lsrq_approved', status: 'approved' },
    {
      ...fieldGuide,
      id: 'lsrq_old',
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 'lsrq_other_seller',
      merchant_url: 'https://example.com',
      created_at,
      status: 'pending_approval',
    },
  ];
  const approvals: string[] = [];
  const validation = run(100, async (args) => {
    if (args[0] === 'test-helpers') {
      approvals.push(args[3]);
      return { id: args[3], status: 'approved' };
    }
    return link(requests)(args);
  });
  const ready = await validation.readyEvent;
  requests.push({
    id: 'lsrq_card',
    merchant_url: ready.tasks?.[0]?.url,
    created_at,
    status: 'pending_approval',
  });
  await validation.exit;
  expect(approvals).toEqual(['lsrq_spt', 'lsrq_card']);
});

it('times out a validation that never finishes', async () => {
  const validation = run(20, async () => undefined);
  expect(await validation.exit).toBe(3);
  expect(validation.results()).toMatchObject({
    'spt-api-purchase': { status: 'timed_out' },
    'spt-api-cancel': { status: 'unverified' },
  });
});
