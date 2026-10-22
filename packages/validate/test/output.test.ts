import { Writable } from 'node:stream';
import { expect, it } from 'vitest';
import { createPrinter } from '../src/output.ts';

function capture(isTTY = false, columns = 80, rows = 40) {
  let text = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  }) as unknown as NodeJS.WriteStream;
  output.isTTY = isTTY;
  output.columns = columns;
  output.rows = rows;
  return { print: createPrinter(output), text: () => text };
}

const task =
  'Buy the trail water bottle from https://127.0.0.1:4321/card-browser-purchase and ship it to my default address.';

function ready(timeout_seconds: number | null = 1800) {
  return {
    event: 'ready',
    timeout_seconds,
    score: { passed: 0, total: 1 },
    tasks: [
      {
        validation: 'card-browser-purchase',
        channel: 'browser',
        url: 'http://127.0.0.1:4321/card-browser-purchase',
        task,
      },
    ],
  };
}

it('scores a validation only after its verdict, never on payment progress', () => {
  const output = capture();
  output.print(ready());
  output.print({
    event: 'progress',
    validation: 'card-browser-purchase',
    step: 'payment_verified',
  });
  expect(output.text()).toContain('card-browser-purchase: Paid');
  output.print({
    event: 'progress',
    validation: 'card-browser-purchase',
    step: 'confirmed',
  });
  expect(output.text()).toContain('card-browser-purchase: Checking');
  expect(output.text()).toContain('Passed 0/1 (0%)');
  expect(output.text()).not.toContain('Passed 1/1 (100%)');

  output.print({
    event: 'validation',
    validation: 'card-browser-purchase',
    status: 'passed',
    score: { passed: 1, total: 1 },
  });
  expect(output.text()).toContain('Passed 1/1 (100%)');
});

it('prints copyable prompts outside the compact table even in a narrow terminal', () => {
  const output = capture(true, 44);
  output.print(ready());
  expect(output.text()).toContain(`\n${task}\n`);
  expect(output.text()).toContain('Status         | Validation');
  expect(output.text()).toContain('⏳ Pending     | card-browser-purchase');
});

it('uses plain output without cursor escapes when stdout is not a TTY', () => {
  const output = capture(false, 240);
  output.print(ready(null));
  output.print({
    event: 'validation',
    validation: 'card-browser-purchase',
    status: 'failed',
    error: 'Payment failed.',
    next_steps: 'Check the sandbox key.',
    score: { passed: 0, total: 1 },
  });
  output.print({
    event: 'result',
    status: 'failed',
    score: { passed: 0, total: 1 },
    validations: [
      {
        id: 'card-browser-purchase',
        status: 'failed',
        error: 'Payment failed.',
        next_steps: 'Check the sandbox key.',
      },
    ],
  });
  expect(output.text()).not.toContain('\u001b');
  expect(output.text()).not.toContain('\r');
  expect(output.text()).toContain(task);
  expect(output.text()).toContain('Check the sandbox key.');
});

it('redraws a TTY table with the updated verdict score', () => {
  const output = capture(true, 80, 40);
  const initial = ready();
  initial.score.total = 2;
  initial.tasks.push({
    validation: 'spt-api-cancel',
    channel: 'api',
    url: 'http://127.0.0.1:4321/spt-api-cancel',
    task: 'Buy the field guide from the local seller.',
  });
  output.print(initial);
  const readyOutput = output.text();
  output.print({
    event: 'validation',
    validation: 'card-browser-purchase',
    status: 'passed',
    score: { passed: 1, total: 2 },
  });

  expect(output.text().slice(readyOutput.length)).toContain('\u001b[');
  expect(output.text().slice(readyOutput.length)).not.toContain(task);
  expect(output.text()).toContain('Passed 1/2 (50%)');
});

it('does not let late progress overwrite an unverified verdict', () => {
  const output = capture();
  output.print(ready());
  output.print({
    event: 'validation',
    validation: 'card-browser-purchase',
    status: 'unverified',
    score: { passed: 0, total: 1 },
  });
  const verdictOutput = output.text();
  output.print({
    event: 'progress',
    validation: 'card-browser-purchase',
    step: 'payment_verified',
  });
  expect(output.text()).toBe(verdictOutput);
});
