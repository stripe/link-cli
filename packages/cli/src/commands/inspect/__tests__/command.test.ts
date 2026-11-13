import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspectCli } from '..';
import { ENTRY } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

async function run(args: string[]) {
  let stdout = '';
  let exitCode = 0;
  await createInspectCli({ userAgent: 'link-cli/1.4.1' }).serve(
    [...args, '--format', 'json'],
    {
      stdout: (text) => {
        stdout += text;
      },
      exit: (code) => {
        exitCode = code;
      },
    },
  );
  return { output: JSON.parse(stdout), exitCode };
}

describe('inspect command', () => {
  it('returns the full Directory response as JSON without authentication', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(ENTRY));
    vi.stubGlobal('fetch', fetchImpl);
    const result = await run(['example.com']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual(ENTRY);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports invalid inputs as command errors', async () => {
    const result = await run(['not a url']);
    expect(result.exitCode).toBe(1);
    expect(result.output.message).toContain('HTTP(S) URL or merchant domain');
  });

  it('surfaces API failures as command errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Inspection unavailable' } },
            { status: 503 },
          ),
        ),
    );
    const result = await run(['example.com']);
    expect(result.exitCode).toBe(1);
    expect(result.output.message).toBe('Inspection unavailable');
  });

  it.each(['0', '-1', '1.5', '2147483648'])(
    'rejects an invalid timeout %s before fetching',
    async (timeout) => {
      const fetchImpl = vi.fn();
      vi.stubGlobal('fetch', fetchImpl);
      const result = await run(['example.com', '--timeout', timeout]);
      expect(result.exitCode).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
