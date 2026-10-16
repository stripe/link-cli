import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Credential } from 'mppx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeStripeChallenge } from '../commands/mpp/decode';
import type {
  CommandArgv,
  CommandContinuation,
} from '../utils/command-continuation';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const CONTEXT =
  'Synthetic purchase context for the command continuation security regression test. No real credentials or payments are used.';
const DESCRIPTION = String.raw`Pro plan esc\" & echo %LINK_ACCESS_TOKEN% > proof.txt & rem \"`;
const CHALLENGE = `Payment id="ch_security", realm="seller.example", method="stripe", intent="charge", description="${DESCRIPTION}", request="${Buffer.from(JSON.stringify({ amount: '1000', currency: 'usd', methodDetails: { networkId: 'net_security', paymentMethodTypes: ['card'] } })).toString('base64')}"`;
const BUSINESS =
  'np_1 \' " & | < > ^ ( ) %LINK_ACCESS_TOKEN% !LINK_REFRESH_TOKEN!';
const CHECKOUT_ID = 'dcs_1 & echo %LINK_ACCESS_TOKEN%';
const SPEND_REQUEST = {
  id: 'lsrq_security',
  status: 'pending_approval',
  credential_type: 'shared_payment_token',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  approval_url: 'https://link.example/approve',
};

let server: http.Server;
let baseUrl: string;
let directory: string;
let createResponse: Record<string, unknown>;
let createStatus: number;
let paidRequest:
  | {
      authorization: string;
      method: string;
      body: string;
      customHeader: string;
    }
  | undefined;
let completeBody: unknown;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'link-cli-continuation-'));
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url ?? '/', 'http://localhost');
    let status = 200;
    let response: unknown;
    if (url.pathname === '/seller') {
      if (req.headers.authorization?.startsWith('Payment ')) {
        paidRequest = {
          authorization: req.headers.authorization,
          method: req.method ?? '',
          body,
          customHeader: String(req.headers['x-custom'] ?? ''),
        };
        response = { paid: true };
      } else {
        status = 402;
        res.setHeader('www-authenticate', CHALLENGE);
        response = { error: 'payment required' };
      }
    } else if (url.pathname === '/spend_requests' && req.method === 'POST') {
      status = createStatus;
      response = createResponse;
    } else if (url.pathname.endsWith('/request_approval')) {
      response = {
        id: SPEND_REQUEST.id,
        approval_link: SPEND_REQUEST.approval_url,
      };
    } else if (url.pathname.startsWith('/spend_requests/')) {
      response = {
        ...SPEND_REQUEST,
        status: 'approved',
        shared_payment_token: { id: 'spt_synthetic_security' },
      };
    } else if (url.pathname === '/ucp/checkout') {
      response = {
        id: CHECKOUT_ID,
        status: 'requires_payment',
        amount_total: 1000,
        currency: 'usd',
      };
    } else if (
      url.pathname.startsWith('/ucp/checkout/') &&
      url.pathname.endsWith('/complete')
    ) {
      completeBody = JSON.parse(body);
      response = { id: CHECKOUT_ID, status: 'completed' };
    } else {
      status = 404;
      response = { error: 'unexpected test request' };
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  createResponse = SPEND_REQUEST;
  createStatus = 200;
  paidRequest = undefined;
  completeBody = undefined;
});

afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function runCli(args: string[]) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [CLI_PATH, ...args, '--format', 'json'],
    {
      cwd: directory,
      shell: false,
      timeout: 10_000,
      env: {
        ...process.env,
        CI: '1',
        LINK_ACCESS_TOKEN: 'synthetic_access_canary',
        LINK_REFRESH_TOKEN: 'synthetic_refresh_canary',
        LINK_NO_REFRESH: '1',
        LINK_HTTP_PROXY: '',
        LINK_AUTH_FILE: join(directory, 'auth.json'),
        LINK_API_BASE_URL: baseUrl,
        LINK_AUTH_BASE_URL: baseUrl,
      },
    },
  );
  return JSON.parse(stdout);
}

function expectPlatformPolicy(next: CommandContinuation) {
  if (process.platform === 'win32') {
    expect(next).not.toHaveProperty('command');
    expect(next).not.toHaveProperty('shell');
  } else {
    expect(next.command).toBeTypeOf('string');
    expect(next.shell).toBe('posix');
  }
}

const createArgs = [
  'spend-request',
  'create',
  '--payment-method-id',
  'pd_synthetic',
  '--credential-type',
  'shared_payment_token',
  '--network-id',
  'net_security',
  '--context',
  CONTEXT,
  '--amount',
  '1000',
];

describe('command continuations', () => {
  it('accepts the malicious challenge and completes MPP using argv without executing it', async () => {
    expect(decodeStripeChallenge(CHALLENGE)).toMatchObject({
      description:
        'Pro plan esc" & echo %LINK_ACCESS_TOKEN% > proof.txt & rem "',
      network_id: 'net_security',
    });
    const data = '{"value":"\' & echo %LINK_ACCESS_TOKEN% > proof.txt"}';
    const header = 'X-Custom: %LINK_REFRESH_TOKEN% & echo unsafe';
    const output = await runCli([
      'mpp',
      'pay',
      `${baseUrl}/seller?value=%25LINK_ACCESS_TOKEN%25`,
      '--context',
      CONTEXT,
      '--payment-method-id',
      'pd_synthetic',
      '-d',
      data,
      '-H',
      header,
    ]);
    const next = output[0]._next as {
      pay_argv: CommandArgv;
      poll_argv: CommandArgv;
      pay_command?: string;
      poll_command?: string;
      shell?: string;
    };
    expect(next.pay_argv.command).toBe('mpp');
    expect(
      next.pay_argv.args[
        next.pay_argv.args.indexOf('--approved-challenge') + 1
      ],
    ).toBe(CHALLENGE);
    expect(next.pay_argv.args).toContain(data);
    expect(next.pay_argv.args).toContain(
      'x-custom: %LINK_REFRESH_TOKEN% & echo unsafe',
    );
    expect(next.pay_argv.args[1]).toBe(
      `${baseUrl}/seller?value=%25LINK_ACCESS_TOKEN%25`,
    );
    expect(next.poll_argv).toEqual({
      command: 'spend-request',
      args: [
        'retrieve',
        SPEND_REQUEST.id,
        '--interval',
        '2',
        '--max-attempts',
        '300',
      ],
    });
    expect(output[0].instruction).toContain('_next.poll_argv');
    expect(output[0].instruction).not.toContain('pay_command');
    if (process.platform === 'win32') {
      expect(next).not.toHaveProperty('pay_command');
      expect(next).not.toHaveProperty('poll_command');
      expect(next).not.toHaveProperty('shell');
    } else {
      expect(next.pay_command).toContain('--approved-challenge');
      expect(next.poll_command).toContain('spend-request retrieve');
      expect(next.shell).toBe('posix');
    }
    await runCli([next.poll_argv.command, ...next.poll_argv.args]);
    const paid = await runCli([next.pay_argv.command, ...next.pay_argv.args]);
    expect(paid[0]).toMatchObject({ status: 200 });
    expect(paidRequest).toMatchObject({
      method: 'POST',
      body: data,
      customHeader: '%LINK_REFRESH_TOKEN% & echo unsafe',
    });
    if (!paidRequest) throw new Error('Missing payment request');
    expect(
      Credential.deserialize(paidRequest.authorization).challenge.description,
    ).toBe(decodeStripeChallenge(CHALLENGE).description);
    expect(existsSync(join(directory, 'proof.txt'))).toBe(false);
  }, 10_000);

  it.each([false, true])(
    'preserves UCP values and replaces only the spend-request argument (test: %s)',
    async (test) => {
      const output = await runCli([
        'ucp',
        'checkout',
        'create',
        '--business',
        BUSINESS,
        '--line-item',
        'id:sku_synthetic,quantity:1',
        ...(test ? ['--test'] : []),
      ]);
      const next = output._next as CommandContinuation;
      expectPlatformPolicy(next);
      expect(next.argv).toEqual({
        command: 'ucp',
        args: [
          'checkout',
          'complete',
          CHECKOUT_ID,
          '--spend-request-id',
          '<spend_request_id>',
          '--business',
          BUSINESS,
          ...(test ? ['--test'] : []),
        ],
      });
      expect(output.instruction).toContain(
        'Replace only the <spend_request_id> argument',
      );
      const args = [...next.argv.args];
      args[args.indexOf('--spend-request-id') + 1] = SPEND_REQUEST.id;
      await runCli([next.argv.command, ...args]);
      expect(completeBody).toEqual({
        profile_id: BUSINESS,
        spend_request_id: SPEND_REQUEST.id,
        ...(test ? { test: true } : {}),
      });
      expect(existsSync(join(directory, 'proof.txt'))).toBe(false);
    },
    10_000,
  );

  it.each(['pending_approval', 'requires_action'])(
    'returns structured spend-request polling for %s',
    async (status) => {
      createResponse = {
        ...SPEND_REQUEST,
        status,
        status_details: {
          requires_action: {
            next_action: {
              type: 'three_d_secure',
              resolution: 'auto_resume',
              action_url: 'https://link.example/verify',
            },
          },
        },
      };
      const output = await runCli(createArgs);
      expectPlatformPolicy(output[0]._next);
      expect(output[0]._next.argv.command).toBe('spend-request');
      expect(output[0]._next.argv.args).toContain(SPEND_REQUEST.id);
      expect(output[0].instruction).toContain(
        '_next.argv directly without a shell',
      );
    },
  );

  it('tells the agent to keep polling through partner_auth_challenge', async () => {
    createResponse = {
      ...SPEND_REQUEST,
      status: 'requires_action',
      status_details: {
        requires_action: {
          next_action: {
            type: 'partner_auth_challenge',
            resolution: 'auto_resume',
            display_message: 'Complete verification in the Link app.',
            action_url: 'https://link.example/verify',
          },
        },
      },
    };
    const output = await runCli(createArgs);
    expect(output[0]._next.argv.args).toEqual(
      expect.arrayContaining(['retrieve', SPEND_REQUEST.id, '--interval']),
    );
    expect(output[0].instruction).toContain(
      'requires additional verification (partner_auth_challenge): Complete verification in the Link app.',
    );
    expect(output[0].instruction).toContain('https://link.example/verify');
    expect(output[0].instruction).toContain(
      'Do not create a new spend request',
    );
    expect(output[0].instruction).not.toContain('3D Secure');
  });

  it('returns structured polling after explicitly requesting approval', async () => {
    const output = await runCli([
      'spend-request',
      'request-approval',
      SPEND_REQUEST.id,
    ]);
    expectPlatformPolicy(output[0]._next);
    expect(output[0]._next.argv.args).toContain(SPEND_REQUEST.id);
  });

  it('keeps duplicate-request errors while removing the Windows dynamic CTA', async () => {
    const id = 'lsrq_duplicate & echo %LINK_ACCESS_TOKEN%';
    createStatus = 429;
    createResponse = {
      error: {
        code: 'spend_request_rate_limited',
        message: 'Synthetic duplicate request',
        duplicate_spend_request: { ...SPEND_REQUEST, id },
      },
    };
    try {
      await runCli(createArgs);
      throw new Error('Expected duplicate-request failure');
    } catch (error) {
      const result = error as { code?: number; stdout?: string };
      expect(result.code).toBe(1);
      const output = JSON.parse(result.stdout ?? '');
      expect(output.code).toBe('spend_request_rate_limited');
      if (process.platform === 'win32') {
        expect(output.message).toContain(
          JSON.stringify({ command: 'spend-request', args: ['retrieve', id] }),
        );
        expect(output._meta?.cta).toBeUndefined();
      } else {
        expect(output.message).toContain(id);
        expect(output.message).not.toContain(`spend-request retrieve ${id}`);
      }
    }
  });
});
