import { describe, expect, it, vi } from 'vitest';
import { pollUntil } from '../poll-until';

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe('pollUntil', () => {
  it('yields terminal on first call when isTerminal returns true', async () => {
    const fn = vi.fn(async () => 'done');
    const results = await collect(
      pollUntil({
        fn,
        isTerminal: (v) => v === 'done',
        interval: 1,
        maxAttempts: 10,
        timeout: 60,
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ value: 'done', terminal: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('yields terminal after N iterations', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      return calls >= 3 ? 'final' : `attempt-${calls}`;
    });

    const results = await collect(
      pollUntil({
        fn,
        isTerminal: (v) => v === 'final',
        interval: 0.01,
        maxAttempts: 0,
        timeout: 60,
      }),
    );

    // Should yield intermediate changes then the terminal value
    const terminal = results[results.length - 1];
    expect(terminal).toEqual({ value: 'final', terminal: true });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops when max attempts are exhausted', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      return `attempt-${calls}`;
    });

    const results = await collect(
      pollUntil({
        fn,
        isTerminal: () => false,
        interval: 0.01,
        maxAttempts: 3,
        timeout: 60,
      }),
    );

    const last = results[results.length - 1];
    expect(last.terminal).toBe(true);
    expect(last.reason).toBe('max_attempts');
    // fn called: 1 initial + up to maxAttempts iterations
    // First call isn't terminal, so attempts increments. After 3 attempts it stops.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops when timeout is exhausted', async () => {
    // Use a timeout of 0 seconds so deadline is already in the past after first call
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      return `attempt-${calls}`;
    });

    const results = await collect(
      pollUntil({
        fn,
        isTerminal: () => false,
        interval: 0.01,
        maxAttempts: 0,
        timeout: 0.001, // 1ms timeout — will be exceeded after first iteration
      }),
    );

    const last = results[results.length - 1];
    expect(last.terminal).toBe(true);
    expect(last.reason).toBe('timeout');
  });

  it('deduplicates: same value is not re-yielded as intermediate', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      // Returns 'a' for first 3 calls, then 'b', then terminal
      if (calls <= 3) return 'a';
      if (calls === 4) return 'b';
      return 'terminal';
    });

    const results = await collect(
      pollUntil({
        fn,
        isTerminal: (v) => v === 'terminal',
        interval: 0.01,
        maxAttempts: 0,
        timeout: 60,
      }),
    );

    // Intermediate yields: 'a' (once, deduped), 'b' (once), then terminal
    const intermediates = results.filter((r) => !r.terminal);
    expect(intermediates).toHaveLength(2);
    expect(intermediates[0].value).toBe('a');
    expect(intermediates[1].value).toBe('b');

    const terminal = results[results.length - 1];
    expect(terminal).toEqual({ value: 'terminal', terminal: true });
  });

  it('runs once without looping when interval <= 0 (single-shot)', async () => {
    const fn = vi.fn(async () => 'non-terminal');

    const results = await collect(
      pollUntil({
        fn,
        isTerminal: () => false,
        interval: 0,
        maxAttempts: 10,
        timeout: 60,
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ value: 'non-terminal', terminal: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs once without looping when interval is negative', async () => {
    const fn = vi.fn(async () => 'value');

    const results = await collect(
      pollUntil({
        fn,
        isTerminal: () => false,
        interval: -1,
        maxAttempts: 10,
        timeout: 60,
      }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ value: 'value', terminal: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from fn', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    await expect(
      collect(
        pollUntil({
          fn,
          isTerminal: () => false,
          interval: 1,
          maxAttempts: 10,
          timeout: 60,
        }),
      ),
    ).rejects.toThrow('fetch failed');
  });
});
