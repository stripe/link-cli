import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspectCli } from '..';

afterEach(() => vi.unstubAllGlobals());

async function run(args: string[]) {
  let stdout = '';
  let exitCode = 0;
  await createInspectCli().serve([...args, '--format', 'json'], {
    stdout: (text) => {
      stdout += text;
    },
    exit: (code) => {
      exitCode = code;
    },
  });
  return { output: JSON.parse(stdout), exitCode };
}

describe('inspect command', () => {
  it('returns discovery as JSON without authentication', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (input.toString().endsWith('/llms.txt')) {
          return new Response('# Test Shop\n\n> Widgets for agents.', {
            headers: { 'content-type': 'text/plain' },
          });
        }
        return new Response('', { status: 404 });
      }),
    );
    const result = await run(['https://shop.example.com/checkout']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual({
      url: 'https://shop.example.com',
      display_name: 'Test Shop',
      description: 'Widgets for agents.',
      llms_txt: ['https://shop.example.com/llms.txt'],
    });
  });

  it('reports invalid URLs as command errors', async () => {
    const result = await run(['not-a-url']);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatchObject({
      message: 'Invalid URL: not-a-url',
    });
  });

  it.each(['0', '-1', '1.5', '2147483648'])(
    'rejects an invalid timeout %s before fetching',
    async (timeout) => {
      const fetchImpl = vi.fn();
      vi.stubGlobal('fetch', fetchImpl);
      const result = await run([
        'https://shop.example.com',
        '--timeout',
        timeout,
      ]);
      expect(result.exitCode).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
