import { Cli, z } from 'incur';
import { describe, expect, it } from 'vitest';
import { createOptions } from '../schema';

describe('recurring interval', () => {
  it('accepts known intervals through the CLI parser and rejects unknown intervals', async () => {
    const cli = Cli.create('test', {
      options: z.object({
        recurringInterval: createOptions.shape.recurringInterval,
      }),
      run: (c) => c.options,
    });
    let stdout = '';
    await cli.serve(['--recurring-interval', 'hour', '--format', 'json'], {
      stdout: (text) => {
        stdout += text;
      },
      exit: (code) => expect(code).toBe(0),
    });
    expect(JSON.parse(stdout)).toEqual({ recurringInterval: 'hour' });
    expect(
      createOptions.shape.recurringInterval.safeParse('minute').success,
    ).toBe(false);
  });

  it('advertises only public intervals in help and JSON schemas', async () => {
    const cli = Cli.create('test', { options: createOptions, run: () => ({}) });
    let help = '';
    await cli.serve(['--help'], {
      stdout: (text) => {
        help += text;
      },
    });
    expect(help).toContain('--recurring-interval');
    expect(help).toContain('day, week, month, or year');
    expect(help).not.toContain('hour');

    const schema = z.toJSONSchema(createOptions);
    expect(schema.properties?.recurringInterval).toMatchObject({
      enum: ['day', 'week', 'month', 'year'],
    });
    expect(JSON.stringify(schema)).not.toContain('hour');
  });
});

const purchase = { amount: 100, context: 'Purchase context. '.repeat(10) };
const callbackUrl =
  'https://agent.example.com/link/callback?return=%2fcheckout';

describe('spend-request callback context', () => {
  it('accepts omitted callback context', () => {
    const result = createOptions.parse(purchase);
    expect(result.completionCallbackUrl).toBeUndefined();
    expect(result.nonce).toBeUndefined();
  });

  it.each([' opaque+nonce ', 'a'.repeat(512), '\u{10000}'.repeat(256)])(
    'preserves valid callback context %#',
    (nonce) => {
      const result = createOptions.parse({
        ...purchase,
        completionCallbackUrl: callbackUrl,
        nonce,
      });
      expect(result.completionCallbackUrl).toBe(callbackUrl);
      expect(result.nonce).toBe(nonce);
    },
  );

  it('accepts a callback URL at the length limit', () => {
    const url = `https://agent.example.com/${'a'.repeat(2022)}`;
    expect(url.length).toBe(2048);
    expect(
      createOptions.parse({
        ...purchase,
        completionCallbackUrl: url,
        nonce: 'n',
      }).completionCallbackUrl,
    ).toBe(url);
  });

  it.each([
    { completionCallbackUrl: callbackUrl },
    { nonce: 'nonce' },
    { completionCallbackUrl: callbackUrl, nonce: '' },
    { completionCallbackUrl: callbackUrl, nonce: ' \t\n' },
    { completionCallbackUrl: callbackUrl, nonce: 'a'.repeat(513) },
    {
      completionCallbackUrl: callbackUrl,
      nonce: `${'\u{10000}'.repeat(256)}a`,
    },
    { completionCallbackUrl: 'not a URL', nonce: 'nonce' },
    {
      completionCallbackUrl: `https://agent.example.com/${'a'.repeat(2023)}`,
      nonce: 'nonce',
    },
  ])('rejects invalid callback context %#', (input) => {
    expect(createOptions.safeParse({ ...purchase, ...input }).success).toBe(
      false,
    );
  });
});
