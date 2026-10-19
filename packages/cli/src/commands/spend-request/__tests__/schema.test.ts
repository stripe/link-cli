import { Cli, z } from 'incur';
import { describe, expect, it } from 'vitest';
import { createOptions } from '../schema';

describe('recurring interval', () => {
  it('accepts known intervals through the CLI parser and rejects unknown intervals', async () => {
    const cli = Cli.create('test', {
      options: createOptions.pick({ recurringInterval: true }),
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
