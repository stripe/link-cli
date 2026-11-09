import { Cli, z } from 'incur';
import { describe, expect, it } from 'vitest';
import { createOptions, retrieveOptions } from '../schema';

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

    const schema = z.toJSONSchema(createOptions);
    expect(schema.properties?.recurringInterval).toMatchObject({
      enum: ['day', 'week', 'month', 'year'],
    });
    expect(JSON.stringify(schema.properties?.recurringInterval)).not.toContain(
      'hour',
    );
    expect(schema.properties?.expiresAt).toMatchObject({
      anyOf: [
        { type: 'integer' },
        { type: 'string', format: 'date-time', pattern: 'Z$' },
      ],
    });
  });
});

const purchase = { amount: 100, context: 'Purchase context. '.repeat(10) };
const callbackUrl =
  'https://agent.example.com/link/callback?return=%2fcheckout';

describe('spend-request expiry', () => {
  it.each(['1800000000', '2027-01-15T08:00:00Z'])(
    'converts CLI input %s to Unix seconds',
    async (value) => {
      const cli = Cli.create('test', {
        options: z.object({ expiresAt: createOptions.shape.expiresAt }),
        run: (c) => c.options,
      });
      let stdout = '';
      await cli.serve(['--expires-at', value, '--format', 'json'], {
        stdout: (text) => {
          stdout += text;
        },
        exit: (code) => expect(code).toBe(0),
      });
      expect(JSON.parse(stdout)).toEqual({ expiresAt: 1800000000 });
    },
  );

  it.each([
    '2027-01-15T08:00:00',
    '2027-01-15T08:00:00+00:00',
    '2027-01-15',
    '2027-02-30T08:00:00Z',
    'not-a-date',
    '1800000000.5',
  ])('rejects invalid or non-Z expiry %s', (expiresAt) => {
    expect(createOptions.safeParse({ ...purchase, expiresAt }).success).toBe(
      false,
    );
  });

  it('preserves numeric agent input and converts fractional ISO seconds', () => {
    expect(
      createOptions.parse({ ...purchase, expiresAt: 1800000000 }).expiresAt,
    ).toBe(1800000000);
    expect(
      createOptions.parse({
        ...purchase,
        expiresAt: '2027-01-15T08:00:00.999Z',
      }).expiresAt,
    ).toBe(1800000000);
  });
});

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

describe('retrieve snapshot options', () => {
  it('preserves ordinary retrieve defaults', () => {
    expect(retrieveOptions.parse({})).toEqual({
      nextAction: false,
      timeout: 600,
      interval: 0,
      maxAttempts: 0,
      include: [],
      force: false,
    });
  });

  it('accepts the boolean flag without cross-option schema refinements', () => {
    expect(
      retrieveOptions.parse({ nextAction: true, include: ['card'] }).nextAction,
    ).toBe(true);
    expect(retrieveOptions.safeParse({ nextAction: 'true' }).success).toBe(
      false,
    );
  });
});
