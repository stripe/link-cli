import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { ENTRY } from './fixtures';

const execFileAsync = promisify(execFile);
const cliPath = new URL('../../../../dist/cli.js', import.meta.url).pathname;

it('uses the public API through the built CLI without forwarding credentials', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'link-inspect-test-'));
  const mockPath = path.join(directory, 'fetch.mjs');
  const responsePath = path.join(directory, 'response.json');
  const logPath = path.join(directory, 'requests.jsonl');
  try {
    await writeFile(responsePath, JSON.stringify(ENTRY));
    await writeFile(
      mockPath,
      `
      import { appendFileSync, readFileSync } from 'node:fs';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        // Ink loads its layout engine from a data URL during module startup.
        if (String(url).startsWith('data:')) return originalFetch(url, init);
        appendFileSync(process.env.INSPECT_TEST_LOG,
          JSON.stringify({ url: String(url), method: init.method, headers: init.headers }) + '\\n');
        return Response.json(JSON.parse(readFileSync(process.env.INSPECT_TEST_RESPONSE, 'utf8')));
      };
    `,
    );
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        '--import',
        mockPath,
        cliPath,
        'inspect',
        'example.com',
        '--format',
        'json',
      ],
      {
        env: {
          ...process.env,
          LINK_AUTH_FILE: path.join(directory, 'auth.json'),
          LINK_ACCESS_TOKEN: 'test_link_token_never_forwarded',
          LINK_REFRESH_TOKEN: 'test_refresh_token_never_forwarded',
          STRIPE_API_KEY: 'sk_test_never_forwarded',
          LINK_API_BASE_URL: 'https://ignored.example',
          INSPECT_TEST_LOG: logPath,
          INSPECT_TEST_RESPONSE: responsePath,
        },
        timeout: 10_000,
      },
    );
    expect(JSON.parse(stdout)).toEqual(ENTRY);
    const requests = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      url: 'https://api.stripe.com/v1/directory/inspect?url=example.com',
      method: 'GET',
      headers: {
        'User-Agent': expect.stringMatching(/^link-cli\//),
        'Stripe-Version': '2026-10-28.preview',
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
