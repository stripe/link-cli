import { expect, it, vi } from 'vitest';
import { runValidation } from './run.ts';
import { createSptAdapter } from './spt.ts';

type Event = { event?: string; url?: string; [key: string]: unknown };

function run(timeoutMs: number) {
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
  });
  return { events, readyEvent, exit };
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

it('prints the task and exits 0 after the buyer pays and confirms', async () => {
  const validation = run(0);
  const { url, task } = await validation.readyEvent;
  expect(task).toBe(
    `Buy the digital trail guide from ${url} and confirm your purchase.`,
  );
  const receipt = await post(`${url}/purchase`, { spt: 'spt_test_buyer' });
  await post(`${url}/confirm`, {
    confirmation_token: receipt.confirmation_token,
  });
  expect(await validation.exit).toBe(0);
  expect(validation.events.at(-1)).toMatchObject({
    event: 'result',
    status: 'passed',
  });
});

it('exits 3 with next steps when the buyer does not finish', async () => {
  const validation = run(20);
  expect(await validation.exit).toBe(3);
  expect(validation.events.at(-1)).toMatchObject({
    status: 'timed_out',
    next_steps: expect.any(String),
  });
});
