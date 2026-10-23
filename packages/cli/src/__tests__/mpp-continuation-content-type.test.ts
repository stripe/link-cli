import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Challenge } from 'mppx';
import { afterEach, expect, it, vi } from 'vitest';
import { buildHeaders } from '../commands/mpp/pay';

afterEach(() => vi.unstubAllGlobals());

it.each(['Content-Type', 'content-type', 'CONTENT-TYPE'])(
  'lets a %s override replace the default JSON header',
  (name) => {
    vi.stubGlobal('__CLI_VERSION__', 'test');
    expect(
      new Headers(buildHeaders('plain text', [`${name}: text/plain`])).get(
        'content-type',
      ),
    ).toBe('text/plain');
  },
);

it('keeps the last repeated header regardless of casing', () => {
  vi.stubGlobal('__CLI_VERSION__', 'test');
  const headers = new Headers(
    buildHeaders(undefined, [
      'X-Custom: first',
      'x-custom: second',
      'user-agent: Custom/1.0',
    ]),
  );
  expect(headers.get('x-custom')).toBe('second');
  expect(headers.get('user-agent')).toBe('Custom/1.0');
  expect(headers.has('content-type')).toBe(false);
});

it('completes a JSON MPP payment using the generated continuation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'link-mpp-content-type-'));
  const observed: string[] = [];
  const challenge = Challenge.serialize({
    id: 'ch_headers',
    realm: 'merchant.example',
    method: 'stripe',
    intent: 'charge',
    request: {
      amount: '1000',
      currency: 'usd',
      networkId: 'net_headers',
      paymentMethodTypes: ['card'],
    },
  });
  const spendRequest = {
    id: 'lsrq_headers',
    status: 'pending_approval',
    credential_type: 'shared_payment_token',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    approval_url: 'https://example.invalid/approve',
  };
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume the synthetic request body */
    }
    let status = 200;
    let data: unknown;
    if (req.url === '/seller') {
      const contentType = String(req.headers['content-type']);
      observed.push(contentType);
      if (contentType !== 'application/json') {
        status = 415;
        data = { error: 'Expected a single application/json content type' };
      } else if (req.headers.authorization?.startsWith('Payment ')) {
        data = { paid: true };
      } else {
        status = 402;
        res.setHeader('www-authenticate', challenge);
        data = { error: 'payment required' };
      }
    } else if (req.method === 'POST' && req.url === '/spend_requests') {
      data = spendRequest;
    } else if (req.url?.startsWith('/spend_requests/lsrq_headers')) {
      data = {
        ...spendRequest,
        status: 'approved',
        shared_payment_token: { id: 'spt_synthetic_headers' },
      };
    } else {
      status = 404;
      data = { error: 'Unexpected test route' };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No server address');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const run = async (args: string[]) => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(new URL('../../dist/cli.js', import.meta.url)),
          ...args,
          '--format',
          'json',
        ],
        {
          cwd: directory,
          shell: false,
          timeout: 10_000,
          env: {
            ...process.env,
            CI: '1',
            NO_UPDATE_NOTIFIER: '1',
            LINK_ACCESS_TOKEN: 'synthetic_access',
            LINK_REFRESH_TOKEN: '',
            LINK_NO_REFRESH: '1',
            LINK_HTTP_PROXY: '',
            LINK_AUTH_FILE: join(directory, 'auth.json'),
            LINK_API_BASE_URL: baseUrl,
            LINK_AUTH_BASE_URL: baseUrl,
          },
        },
      );
      return JSON.parse(stdout);
    };
    const initial = await run([
      'mpp',
      'pay',
      `${baseUrl}/seller`,
      '--payment-method-id',
      'pd_synthetic',
      '--test',
      '--context',
      'Synthetic local payment test context. '.repeat(4),
      '--data',
      '{"item":"synthetic"}',
    ]);
    const next = initial[0]._next.pay_argv;
    const final = await run([next.command, ...next.args]);
    expect(observed[0]).toBe('application/json');
    expect(final[0].status).toBe(200);
    expect(JSON.parse(final[0].body)).toEqual({ paid: true });
    expect(observed).toEqual(Array(3).fill('application/json'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
