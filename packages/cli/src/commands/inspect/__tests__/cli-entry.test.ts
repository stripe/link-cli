import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = new URL('../../../../dist/cli.js', import.meta.url).pathname;

it('discovers a merchant through the built CLI without a Link session', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'link-inspect-test-'));
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    requested.push(req.url ?? '');
    if (req.url === '/api/openapi.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Test Merchant' },
          paths: {
            '/api/order': {
              post: {
                summary: 'Place an order',
                'x-payment-info': { offers: [{ method: 'stripe' }] },
              },
            },
          },
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Mock merchant did not start');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath, 'inspect', `${origin}/checkout`, '--format', 'json'],
      {
        env: {
          ...process.env,
          LINK_AUTH_FILE: path.join(directory, 'auth.json'),
          LINK_ACCESS_TOKEN: '',
          LINK_REFRESH_TOKEN: '',
        },
        timeout: 10_000,
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      url: origin,
      display_name: 'Test Merchant',
      available_tools: {
        machine_payments: [
          {
            command: `link-cli mpp pay '${origin}/api/order' --method POST`,
            description: 'Place an order',
            url: `${origin}/api/order`,
            method: 'stripe',
          },
        ],
      },
    });
    expect(requested).toContain('/.well-known/ucp');
    expect(requested).not.toContain('/api/order');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
