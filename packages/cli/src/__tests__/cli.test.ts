import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { storage } from '@stripe/link-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const CLI_PATH = new URL('../../dist/cli.js', import.meta.url).pathname;

const AUTH_TOKENS = {
  access_token: 'test_access_token_1234567890',
  refresh_token: 'test_refresh_token_1234567890',
  expires_in: 3600,
  token_type: 'Bearer',
};

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw.trim());
}

beforeEach(() => {
  storage.clearAll();
  storage.setAuth(AUTH_TOKENS);
});

afterAll(() => {
  storage.clearAll();
});

// ─── Production mode tests (real HTTP against local mock server) ────────────

const PROD_AUTH_TOKENS = {
  access_token: 'prod_test_access_token',
  refresh_token: 'prod_test_refresh_token',
  expires_in: 3600,
  token_type: 'Bearer',
};

// Must be >= 100 characters to satisfy schema validation
const VALID_CONTEXT =
  'Office supplies for the team. This includes pens, paper, notebooks, and other stationery for daily office use.';

const BASE_REQUEST = {
  id: 'lsrq_prod_001',
  merchant_name: 'Test Merchant',
  merchant_url: 'https://example.com',
  context: VALID_CONTEXT,
  amount: 5000,
  line_items: [{ name: 'Widget', unit_amount: 5000, quantity: 1 }],
  totals: [{ type: 'total', display_text: 'Total', amount: 5000 }],
  payment_details: 'pd_prod_test',
  status: 'created',
  created_at: '2026-03-10T00:00:00Z',
  updated_at: '2026-03-10T00:00:00Z',
};

interface RequestLog {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let serverPort: number;
let lastRequest: RequestLog;
let requests: RequestLog[];
let nextResponse: { status: number; body: unknown };
let responsesByUrl: Record<string, { status: number; body: unknown }> = {};

// ─── Second mock server for merchant endpoints ─────────────────────────────
let merchantServer: http.Server;
let merchantPort: number;
let merchantRequests: RequestLog[];
let merchantResponses: {
  status: number;
  headers?: Record<string, string>;
  body: string;
}[];

function setMerchantResponse(
  status: number,
  body: string,
  headers?: Record<string, string>,
) {
  merchantResponses.push({ status, headers, body });
}

function setNextResponse(status: number, body: unknown) {
  nextResponse = { status, body };
}

function setResponseForUrl(url: string, status: number, body: unknown) {
  responsesByUrl[url] = { status, body };
}

async function runProdCli(...args: string[]): Promise<CliResult> {
  return runProdCliWithEnv({}, ...args);
}

async function runProdCliWithEnv(
  extraEnv: Record<string, string>,
  ...args: string[]
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          LINK_API_BASE_URL: `http://127.0.0.1:${serverPort}`,
          LINK_AUTH_BASE_URL: `http://127.0.0.1:${serverPort}`,
          XDG_DATA_HOME: '/tmp/link-cli-test-empty',
          ...extraEnv,
        },
        timeout: 10_000,
      },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
    };
  }
}

describe('production mode', () => {
  beforeAll(async () => {
    merchantServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        merchantRequests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        const next = merchantResponses.shift() ?? { status: 200, body: '{}' };
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...next.headers,
        };
        res.writeHead(next.status, headers);
        res.end(next.body);
      });
    });

    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        lastRequest = {
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        };
        requests.push(lastRequest);

        const urlOverride = responsesByUrl[req.url ?? ''];
        const response = urlOverride ?? nextResponse;
        res.writeHead(response.status, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify(response.body));
      });
    });

    await Promise.all([
      new Promise<void>((resolve) => {
        merchantServer.listen(0, '127.0.0.1', () => {
          const addr = merchantServer.address() as { port: number };
          merchantPort = addr.port;
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          serverPort = addr.port;
          resolve();
        });
      }),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => merchantServer.close(() => resolve())),
    ]);
  });

  beforeEach(() => {
    requests = [];
    responsesByUrl = {};
    merchantRequests = [];
    merchantResponses = [];
    storage.setAuth(PROD_AUTH_TOKENS);
    setNextResponse(200, BASE_REQUEST);
  });

  describe('spend-request create', () => {
    it('sends POST to /spend_requests with correct headers and body', async () => {
      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_prod_test',
        '--merchant-name',
        'Test Merchant',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--line-item',
        'name:Widget,unit_amount:5000,quantity:1',
        '--total',
        'type:total,display_text:Total,amount:5000',
        '--no-request-approval',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('POST');
      expect(lastRequest.url).toBe('/spend_requests');
      expect(lastRequest.headers['content-type']).toBe('application/json');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      const sentBody = JSON.parse(lastRequest.body);
      expect(sentBody.payment_details).toBe('pd_prod_test');
      expect(sentBody.amount).toBe(5000);
      expect(sentBody.merchant_name).toBe('Test Merchant');
      expect(sentBody.line_items).toEqual([
        { name: 'Widget', unit_amount: 5000, quantity: 1 },
      ]);
      expect(sentBody.totals).toEqual([
        { type: 'total', display_text: 'Total', amount: 5000 },
      ]);
    });

    it('returns the API response as JSON output', async () => {
      setNextResponse(200, { ...BASE_REQUEST, id: 'lsrq_from_api' });

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_prod_test',
        '--merchant-name',
        'Test Merchant',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--line-item',
        'name:Widget,unit_amount:5000,quantity:1',
        '--total',
        'type:total,display_text:Total,amount:5000',
        '--no-request-approval',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output[0].id).toBe('lsrq_from_api');
    });

    it('sends credential_type and network_id in HTTP POST body', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        credential_type: 'shared_payment_token',
        network_id: 'net_prod_abc',
      });

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_prod_test',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--credential-type',
        'shared_payment_token',
        '--network-id',
        'net_prod_abc',
        '--no-request-approval',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const sentBody = JSON.parse(lastRequest.body);
      expect(sentBody.credential_type).toBe('shared_payment_token');
      expect(sentBody.network_id).toBe('net_prod_abc');

      const output = parseJson(result.stdout) as Record<string, unknown>[];
      const request = output[0];
      expect(request.credential_type).toBe('shared_payment_token');
      expect(request.network_id).toBe('net_prod_abc');
    });

    it('sends test flag in POST body when --test is used', async () => {
      setNextResponse(200, BASE_REQUEST);

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_prod_test',
        '--merchant-name',
        'Test Merchant',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--no-request-approval',
        '--test',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const sentBody = JSON.parse(lastRequest.body);
      expect(sentBody.test).toBe(true);
    });

    it('does not send test flag in POST body when --test is not used', async () => {
      setNextResponse(200, BASE_REQUEST);

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_prod_test',
        '--merchant-name',
        'Test Merchant',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--no-request-approval',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const sentBody = JSON.parse(lastRequest.body);
      expect(sentBody.test).toBeUndefined();
    });

    it('sends request_approval in create body, outputs approval URL immediately then polls', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'approved',
        approval_url: 'https://app.link.com/approve/lsrq_prod_001',
      });

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_prod_test',
        '-m',
        'Test Merchant',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--line-item',
        'name:Widget,unit_amount:5000,quantity:1',
        '--total',
        'type:total,display_text:Total,amount:5000',
        '--request-approval',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      // POST to create — returns immediately, no polling
      expect(requests[0].method).toBe('POST');
      expect(requests[0].url).toBe('/spend_requests');
      const sentBody = JSON.parse(requests[0].body);
      expect(sentBody.request_approval).toBe(true);

      // Single result with _next polling hint
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output.length).toBe(1);
      expect(output[0].approval_url).toBe(
        'https://app.link.com/approve/lsrq_prod_001',
      );
      const next = output[0]._next as Record<string, unknown>;
      expect(next.command).toContain('spend-request retrieve');
      expect(next.command).toContain('--interval');
    });

    it('surfaces API error messages', async () => {
      setNextResponse(422, { error: { message: 'Invalid payment details' } });

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_bad',
        '-m',
        'Test Merchant',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--line-item',
        'name:Widget,unit_amount:5000,quantity:1',
        '--total',
        'type:total,display_text:Total,amount:5000',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('Invalid payment details');
    });
  });

  describe('spend-request update', () => {
    it('sends POST to /spend-requests/:id with update params', async () => {
      setNextResponse(200, { ...BASE_REQUEST, payment_details: 'pd_updated' });

      const result = await runProdCli(
        'spend-request',
        'update',
        'lsrq_prod_001',
        '--payment-method-id',
        'pd_updated',
        '--merchant-url',
        'https://updated.com',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('POST');
      expect(lastRequest.url).toBe('/spend_requests/lsrq_prod_001');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      const sentBody = JSON.parse(lastRequest.body);
      expect(sentBody.payment_details).toBe('pd_updated');
      expect(sentBody.merchant_url).toBe('https://updated.com');
    });

    it('surfaces API errors for update', async () => {
      setNextResponse(409, {
        error: { message: 'Cannot update request in pending_approval status' },
      });

      const result = await runProdCli(
        'spend-request',
        'update',
        'lsrq_prod_001',
        '--payment-method-id',
        'pd_new',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('pending_approval');
    });
  });

  describe('spend-request request-approval', () => {
    it('sends POST to /spend-requests/:id/request_approval, outputs approval_link immediately then polls', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'approved',
        approval_url: 'https://app.link.com/approve/lsrq_prod_001',
      });

      const result = await runProdCli(
        'spend-request',
        'request-approval',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      // POST to request_approval — returns immediately, no polling
      expect(requests[0].method).toBe('POST');
      expect(requests[0].url).toBe(
        '/spend_requests/lsrq_prod_001/request_approval',
      );
      expect(requests[0].headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      // Single result with _next polling hint
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output.length).toBe(1);
      expect(output[0].approval_url).toBe(
        'https://app.link.com/approve/lsrq_prod_001',
      );
      const next = output[0]._next as Record<string, unknown>;
      expect(next.command).toContain('spend-request retrieve');
      expect(next.command).toContain('--interval');
    });

    it('surfaces API errors for request-approval', async () => {
      setNextResponse(400, {
        error: { message: 'request already in pending_approval status' },
      });

      const result = await runProdCli(
        'spend-request',
        'request-approval',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('pending_approval');
    });
  });

  describe('spend-request cancel', () => {
    it('sends POST to /spend_requests/:id/cancel with auth header and no body', async () => {
      setNextResponse(200, { ...BASE_REQUEST, status: 'canceled' });

      const result = await runProdCli(
        'spend-request',
        'cancel',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('POST');
      expect(lastRequest.url).toBe('/spend_requests/lsrq_prod_001/cancel');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );
      expect(lastRequest.body).toBe('');
    });

    it('returns the canceled spend request', async () => {
      setNextResponse(200, { ...BASE_REQUEST, status: 'canceled' });

      const result = await runProdCli(
        'spend-request',
        'cancel',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.status).toBe('canceled');
      expect(output.id).toBe('lsrq_prod_001');
    });

    it('surfaces API errors for cancel (409 terminal state)', async () => {
      setNextResponse(409, {
        error: {
          message:
            'Spend request is in a terminal state and cannot be canceled',
        },
      });

      const result = await runProdCli(
        'spend-request',
        'cancel',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('terminal state');
    });
  });

  describe('spend-request list', () => {
    it('sends GET to /spend_requests and returns the API response as JSON output', async () => {
      const requests_list = [
        { ...BASE_REQUEST, id: 'lsrq_001', status: 'approved' },
        { ...BASE_REQUEST, id: 'lsrq_002', status: 'pending_approval' },
        { ...BASE_REQUEST, id: 'lsrq_003', status: 'created' },
      ];
      setNextResponse(200, { data: requests_list });

      const result = await runProdCli('spend-request', 'list', '--json');

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.url).toBe('/spend_requests');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );
      const output = parseJson(result.stdout) as unknown[];
      expect(output).toHaveLength(3);
      expect((output[0] as Record<string, unknown>).id).toBe('lsrq_001');
      expect((output[0] as Record<string, unknown>).status).toBe('approved');
    });

    it('returns an empty array when there are no active spend requests', async () => {
      setNextResponse(200, { data: [] });

      const result = await runProdCli('spend-request', 'list', '--json');

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as unknown[];
      expect(output).toHaveLength(0);
    });

    it('surfaces API errors for list', async () => {
      setNextResponse(403, { error: { message: 'Forbidden' } });

      const result = await runProdCli('spend-request', 'list', '--json');

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('Forbidden');
    });

    it('exits non-zero with auth error when not logged in', async () => {
      storage.clearAll();

      const result = await runProdCli('spend-request', 'list', '--json');

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/not logged in|auth|login|token/i);
    });

    it('unwraps data envelope so output is a flat array, not an object with a data key', async () => {
      const requests_list = [
        { ...BASE_REQUEST, id: 'lsrq_flat_001', status: 'approved' },
      ];
      setNextResponse(200, { data: requests_list });

      const result = await runProdCli('spend-request', 'list', '--json');

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout);
      expect(Array.isArray(output)).toBe(true);
      const arr = output as Record<string, unknown>[];
      expect(arr[0].id).toBe('lsrq_flat_001');
      expect((output as Record<string, unknown>).data).toBeUndefined();
    });
  });

  describe('spend-request retrieve', () => {
    it('sends GET to /spend-requests/:id', async () => {
      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.url).toBe('/spend_requests/lsrq_prod_001');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );
    });

    it('returns spend request with card details after approval', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'approved',
        card: {
          id: 'card_001',
          brand: 'Visa',
          exp_month: 12,
          exp_year: 2027,
          number: '4242424242424242',
        },
      });

      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      const request = output[0];
      expect(request.status).toBe('approved');
      const card = request.card as Record<string, unknown>;
      expect(card.brand).toBe('Visa');
      expect(card.number).toBe('4242424242424242');
    });

    it('returns card with billing_address and valid_until when present', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'approved',
        card: {
          id: 'card_002',
          brand: 'Visa',
          exp_month: 12,
          exp_year: 2027,
          number: '4242424242424242',
          cvc: '123',
          billing_address: {
            name: 'Jane Doe',
            line1: '123 Main St',
            line2: 'Apt 4',
            city: 'San Francisco',
            state: 'CA',
            postal_code: '94111',
            country: 'US',
          },
          valid_until: '2025-06-15T06:13:20Z',
        },
      });

      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_prod_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      const request = output[0];
      expect(request.status).toBe('approved');
      const card = request.card as Record<string, unknown>;
      expect(card.number).toBe('4242424242424242');
      expect(card.valid_until).toBe('2025-06-15T06:13:20Z');
      const billingAddress = card.billing_address as Record<string, unknown>;
      expect(billingAddress.name).toBe('Jane Doe');
      expect(billingAddress.line1).toBe('123 Main St');
      expect(billingAddress.line2).toBe('Apt 4');
      expect(billingAddress.city).toBe('San Francisco');
      expect(billingAddress.state).toBe('CA');
      expect(billingAddress.postal_code).toBe('94111');
      expect(billingAddress.country).toBe('US');
    });

    it('reports not found on 404', async () => {
      setNextResponse(404, {});

      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_nonexistent',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('not found');
    });

    it('exits non-zero when polling attempts are exhausted before a terminal status', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'pending_approval',
        approval_url: 'https://app.link.com/approve/lsrq_prod_001',
      });

      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_prod_001',
        '--interval',
        '1',
        '--max-attempts',
        '1',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.code).toBe('POLLING_TIMEOUT');
      expect(output.message).toContain('pending_approval');
      expect(output.message).toContain('max attempts');
    });

    it('exits non-zero when polling times out before a terminal status', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'pending_approval',
        approval_url: 'https://app.link.com/approve/lsrq_prod_001',
      });

      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_prod_001',
        '--interval',
        '1',
        '--timeout',
        '0',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.code).toBe('POLLING_TIMEOUT');
      expect(output.message).toContain('pending_approval');
      expect(output.message).toContain('timeout');
    });

    it('exits successfully when polling observes a terminal status', async () => {
      setNextResponse(200, {
        ...BASE_REQUEST,
        status: 'approved',
      });

      const result = await runProdCli(
        'spend-request',
        'retrieve',
        'lsrq_prod_001',
        '--interval',
        '1',
        '--max-attempts',
        '1',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output[0].status).toBe('approved');
    });
  });

  describe('shipping-address list', () => {
    it('sends GET to /shipping_addresses and returns the API response as JSON output', async () => {
      setResponseForUrl('/shipping_addresses', 200, {
        shipping_addresses: [
          {
            id: 'shad_abc123',
            is_default: true,
            nickname: 'Home',
            address: {
              name: 'Jane Doe',
              line_1: '123 Main St',
              line_2: 'Apt 4B',
              locality: 'San Francisco',
              dependent_locality: null,
              administrative_area: 'CA',
              postal_code: '94105',
              sorting_code: null,
              country_code: 'US',
            },
          },
          {
            id: 'shad_def456',
            is_default: false,
            nickname: null,
            address: null,
          },
        ],
      });

      const result = await runProdCli('shipping-address', 'list', '--json');

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.url).toBe('/shipping_addresses');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output[0].id).toBe('shad_abc123');
      expect(output[0].nickname).toBe('Home');
      expect(output[1].id).toBe('shad_def456');
      expect(output[1].nickname).toBeNull();
      expect(output[1].address).toBeNull();
    });

    it('rejects unauthenticated requests before hitting the API', async () => {
      storage.clearAuth();

      const result = await runProdCli('shipping-address', 'list', '--json');

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('Not authenticated');
      const shippingAddressRequest = requests.find(
        (r) => r.url === '/shipping_addresses',
      );
      expect(shippingAddressRequest).toBeUndefined();
    });
  });

  const SAMPLE_TRANSACTION = {
    id: 'lbctxn_001',
    source_id: null,
    amount: -979,
    currency: 'usd',
    created_date: '2026-06-08',
    description: 'Chase',
    origin: 'external_connection',
    category: 'credit_card_payment',
    status: 'succeeded',
  };

  describe('transactions list', () => {
    it('GETs the Link API endpoint with bearer auth', async () => {
      setResponseForUrl('/transactions', 200, {
        data: [SAMPLE_TRANSACTION],
        has_more: true,
      });

      const result = await runProdCli('transactions', 'list', '--json');

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.url).toBe('/transactions');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.has_more).toBe(true);
      expect(Array.isArray(output.data)).toBe(true);
      const data = output.data as Record<string, unknown>[];
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('lbctxn_001');
      expect(data[0].source_id).toBeNull();
      expect(data[0].created_date).toBe('2026-06-08');
      expect(output.transactions).toBeUndefined();
    });

    it('forwards pagination and filter flags into the query string', async () => {
      setNextResponse(200, { data: [] });

      const result = await runProdCli(
        'transactions',
        'list',
        '--limit',
        '5',
        '--starting-after',
        'lbctxn_cursor',
        '--ending-before',
        'lbctxn_prev',
        '--start-date',
        '2026-04-01',
        '--end-date',
        '2026-04-30',
        '--category',
        'other_services',
        '--origin',
        'external_connection',
        '--source',
        'csmrpd_a',
        '--source',
        'csmrpd_b',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.url).toContain('/transactions?');
      expect(lastRequest.url).toContain('limit=5');
      expect(lastRequest.url).toContain('starting_after=lbctxn_cursor');
      expect(lastRequest.url).toContain('ending_before=lbctxn_prev');
      expect(lastRequest.url).toContain('date_start=2026-04-01');
      expect(lastRequest.url).toContain('date_end=2026-04-30');
      expect(lastRequest.url).toContain('category=other_services');
      expect(lastRequest.url).toContain('origin=external_connection');
      expect(lastRequest.url).toContain('sources%5B%5D=csmrpd_a');
      expect(lastRequest.url).toContain('sources%5B%5D=csmrpd_b');
      expect(lastRequest.url).not.toContain('start_date');
      expect(lastRequest.url).not.toContain('end_date');
      expect(lastRequest.url).not.toContain('transaction_category');
    });

    it('accepts --verbose as a global flag', async () => {
      setResponseForUrl('/transactions', 200, { data: [] });

      const result = await runProdCli(
        '--verbose',
        'transactions',
        'list',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.url).toBe('/transactions');
    });

    it('rejects unauthenticated requests before hitting the API', async () => {
      storage.clearAuth();

      const result = await runProdCli('transactions', 'list', '--json');

      expect(result.exitCode).toBe(1);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.code).toBe('NOT_AUTHENTICATED');
      expect(String(output.message)).toMatch(/auth login/i);
      const txnRequest = requests.find((r) => r.url === '/transactions');
      expect(txnRequest).toBeUndefined();
    });

    it('does not show transactions in root help', async () => {
      const result = await runProdCli('--help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).not.toContain('transactions');
    });
  });

  const SAMPLE_SOURCE = {
    id: 'csmrpd_001',
    name: 'Checking 1234',
    type: 'bank_account',
    capabilities: {
      transactions: { status: 'eligible' },
    },
    external_connection: { status: 'active' },
  };

  describe('sources list', () => {
    it('GETs the Link API endpoint with bearer auth', async () => {
      setResponseForUrl('/sources', 200, {
        data: [SAMPLE_SOURCE],
        has_more: true,
      });

      const result = await runProdCli('sources', 'list', '--json');

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.url).toBe('/sources');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.has_more).toBe(true);
      expect(Array.isArray(output.data)).toBe(true);
      const data = output.data as Record<string, unknown>[];
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('csmrpd_001');
      expect(data[0].type).toBe('bank_account');
    });

    it('forwards pagination flags into the query string', async () => {
      setNextResponse(200, {
        data: [],
      });

      const result = await runProdCli(
        'sources',
        'list',
        '--limit',
        '5',
        '--starting-after',
        'csmrpd_cursor',
        '--ending-before',
        'csmrpd_prev',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.url).toContain('/sources?');
      expect(lastRequest.url).toContain('limit=5');
      expect(lastRequest.url).toContain('starting_after=csmrpd_cursor');
      expect(lastRequest.url).toContain('ending_before=csmrpd_prev');
    });

    it('rejects unauthenticated requests before hitting the API', async () => {
      storage.clearAuth();

      const result = await runProdCli('sources', 'list', '--json');

      expect(result.exitCode).toBe(1);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.code).toBe('NOT_AUTHENTICATED');
      expect(String(output.message)).toMatch(/auth login/i);
      const sourcesRequest = requests.find((r) => r.url === '/sources');
      expect(sourcesRequest).toBeUndefined();
    });

    it('does not show sources in root help', async () => {
      const result = await runProdCli('--help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).not.toContain('sources');
    });
  });

  const SAMPLE_BALANCE = {
    source_id: 'csmrpd_001',
    type: 'cash',
    cash: { available: { usd: 12500 } },
    current: 13000,
    currency: 'usd',
    as_of: '2026-07-14T00:00:00Z',
  };

  describe('balances list', () => {
    it('GETs the Link API endpoint with bearer auth', async () => {
      setResponseForUrl('/balances', 200, {
        data: [SAMPLE_BALANCE],
        has_more: true,
      });

      const result = await runProdCli('balances', 'list', '--json');

      expect(result.exitCode).toBe(0);
      expect(lastRequest.method).toBe('GET');
      expect(lastRequest.url).toBe('/balances');
      expect(lastRequest.headers.authorization).toBe(
        'Bearer prod_test_access_token',
      );

      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.has_more).toBe(true);
      expect(Array.isArray(output.data)).toBe(true);
      const data = output.data as Record<string, unknown>[];
      expect(data).toHaveLength(1);
      expect(data[0].source_id).toBe('csmrpd_001');
      expect(data[0].type).toBe('cash');
    });

    it('forwards pagination flags into the query string', async () => {
      setNextResponse(200, {
        data: [],
      });

      const result = await runProdCli(
        'balances',
        'list',
        '--limit',
        '5',
        '--starting-after',
        'csmrpd_cursor',
        '--ending-before',
        'csmrpd_prev',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      expect(lastRequest.url).toContain('/balances?');
      expect(lastRequest.url).toContain('limit=5');
      expect(lastRequest.url).toContain('starting_after=csmrpd_cursor');
      expect(lastRequest.url).toContain('ending_before=csmrpd_prev');
    });

    it('rejects unauthenticated requests before hitting the API', async () => {
      storage.clearAuth();

      const result = await runProdCli('balances', 'list', '--json');

      expect(result.exitCode).toBe(1);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.code).toBe('NOT_AUTHENTICATED');
      expect(String(output.message)).toMatch(/auth login/i);
      const balancesRequest = requests.find((r) => r.url === '/balances');
      expect(balancesRequest).toBeUndefined();
    });

    it('does not show balances in root help', async () => {
      const result = await runProdCli('--help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout + result.stderr).not.toContain('balances');
    });
  });

  describe('auth login', () => {
    const DEVICE_CODE_RESPONSE = {
      device_code: 'test_device_code',
      user_code: 'apple-grape',
      verification_uri: 'https://app.link.com/device/setup',
      verification_uri_complete:
        'https://app.link.com/device/setup?code=apple-grape',
      expires_in: 300,
      interval: 1,
    };

    const TOKEN_RESPONSE = {
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
      token_type: 'Bearer',
    };

    it('rejects whitespace-only --client-name with a validation error', async () => {
      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        '   ',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/client.?name|non-empty/i);
    });

    it('rejects whitespace-only --scope with a validation error', async () => {
      const result = await runProdCli(
        'auth',
        'login',
        '--scope',
        '   ',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/scope|non-empty/i);
    });

    it('exits early with already logged in message when valid session exists', async () => {
      setResponseForUrl('/device/token', 200, {
        access_token: 'refreshed_access_token',
        refresh_token: 'refreshed_refresh_token',
        expires_in: 3600,
        token_type: 'Bearer',
      });

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output[0].authenticated).toBe(true);
      expect(output[0].message).toMatch(/already logged in/i);
      expect(
        requests.find((r) => r.url.includes('/device/code')),
      ).toBeUndefined();
      expect(
        requests.find((r) => r.url.includes('/device/revoke')),
      ).toBeUndefined();
    });

    it('passes a normalized custom --scope to /device/code', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--scope',
        'userinfo:read   spend_requests:approve',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const deviceCodeRequest = requests.find((r) =>
        r.url.includes('/device/code'),
      );
      expect(deviceCodeRequest).toBeDefined();
      const params = new URLSearchParams(deviceCodeRequest?.body);
      expect(params.get('scope')).toBe('userinfo:read spend_requests:approve');
      expect(params.get('authorization_details')).toBeNull();
    });

    it('does not translate source-related --scope values into authorization_details', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--scope',
        'userinfo:read   source_details:read   balances:read',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const deviceCodeRequest = requests.find((r) =>
        r.url.includes('/device/code'),
      );
      expect(deviceCodeRequest).toBeDefined();
      const params = new URLSearchParams(deviceCodeRequest?.body);
      expect(params.get('scope')).toBe(
        'userinfo:read source_details:read balances:read',
      );
      expect(params.get('authorization_details')).toBeNull();
      expect(params.get('authorization_details[0][type]')).toBeNull();
    });

    it('passes source actions via authorization_details', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--source-actions',
        'read_source_details',
        '--source-actions',
        'read_balances',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const deviceCodeRequest = requests.find((r) =>
        r.url.includes('/device/code'),
      );
      expect(deviceCodeRequest).toBeDefined();
      const params = new URLSearchParams(deviceCodeRequest?.body);
      expect(params.get('scope')).toBe('userinfo:read payment_methods.agentic');
      expect(params.get('authorization_details')).toBeNull();
      expect(params.getAll('authorization_details[][type]')).toEqual([
        'source',
      ]);
      expect(params.getAll('authorization_details[][actions][]')).toEqual([
        'read_source_details',
        'read_balances',
      ]);
    });

    it('passes freeform authorization_details entries after source actions', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--source-actions',
        'read_link_transactions',
        '--authorization-detail',
        '{"type":"account","filters":["current",{"include_inactive":true}]}',
        '--authorization-detail',
        'true',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const deviceCodeRequest = requests.find((r) =>
        r.url.includes('/device/code'),
      );
      expect(deviceCodeRequest).toBeDefined();
      const params = new URLSearchParams(deviceCodeRequest?.body);
      expect(params.get('authorization_details')).toBeNull();
      expect(params.getAll('authorization_details[][type]')).toEqual([
        'source',
        'account',
      ]);
      expect(params.getAll('authorization_details[][actions][]')).toEqual([
        'read_link_transactions',
      ]);
      expect(params.getAll('authorization_details[][filters][]')).toEqual([
        'current',
      ]);
      expect(
        params.getAll('authorization_details[][filters][][include_inactive]'),
      ).toEqual(['true']);
      expect(params.getAll('authorization_details[]')).toEqual(['true']);
    });

    it('rejects invalid JSON in --authorization-detail', async () => {
      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--authorization-detail',
        '{"type":',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/authorization-detail|json/i);
    });

    it('sends client_hint and returns immediately with _next polling hint', async () => {
      setResponseForUrl('/device/token', 401, { error: 'invalid_grant' });
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'My Agent',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const deviceCodeRequest = requests.find((r) =>
        r.url.includes('/device/code'),
      );
      expect(deviceCodeRequest).toBeDefined();
      const params = new URLSearchParams(deviceCodeRequest?.body);
      expect(params.get('client_hint')).toBe('My Agent');
      expect(params.get('connection_label')).toContain('My Agent on ');
      expect(params.get('scope')).toBe('userinfo:read payment_methods.agentic');

      // Returns immediately with verification URL and _next hint
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output.length).toBe(1);
      expect(output[0].verification_url).toBe(
        'https://app.link.com/device/setup?code=apple-grape',
      );
      expect(output[0].phrase).toBe('apple-grape');
      const next = output[0]._next as Record<string, unknown>;
      expect(next.command).toContain('auth status');
      expect(next.until).toContain('authenticated');
    });

    it('revokes existing session before starting new login when refresh fails', async () => {
      setResponseForUrl('/device/token', 401, { error: 'invalid_grant' });
      setResponseForUrl('/device/revoke', 200, 'ok');
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'New Agent',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const revokeRequest = requests.find((r) =>
        r.url.includes('/device/revoke'),
      );
      expect(revokeRequest).toBeDefined();
      expect(revokeRequest?.method).toBe('POST');
      const params = new URLSearchParams(revokeRequest?.body);
      expect(params.get('token')).toBe(PROD_AUTH_TOKENS.refresh_token);
    });

    it('proceeds with login even if revoke fails', async () => {
      setResponseForUrl('/device/token', 401, { error: 'invalid_grant' });
      setResponseForUrl('/device/revoke', 500, { error: 'server_error' });
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'New Agent',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output[0].verification_url).toBeDefined();
    });

    it('skips revoke when not previously authenticated', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'Fresh Agent',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const revokeRequest = requests.find((r) =>
        r.url.includes('/device/revoke'),
      );
      expect(revokeRequest).toBeUndefined();
    });

    it('with --interval, yields code first then polls until authenticated', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/revoke', 200, 'ok');
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);
      setResponseForUrl('/device/token', 200, TOKEN_RESPONSE);

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'Polling Agent',
        '--interval',
        '1',
        '--timeout',
        '10',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output.length).toBe(2);
      expect(output[0].verification_url).toBe(
        'https://app.link.com/device/setup?code=apple-grape',
      );
      expect(output[0].phrase).toBe('apple-grape');
      expect(output[0]._next).toBeUndefined();
      expect(output[1].authenticated).toBe(true);
      expect(output[1].token_type).toBe('Bearer');
    });

    it('with --interval, yields unauthenticated status on timeout (exit 0)', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);
      setResponseForUrl('/device/token', 400, {
        error: 'authorization_pending',
      });

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'Timeout Agent',
        '--interval',
        '1',
        '--timeout',
        '2',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      const last = output[output.length - 1];
      expect(last.authenticated).toBe(false);
    });

    it('with --interval, exits with error on access_denied', async () => {
      storage.clearAuth();
      setResponseForUrl('/device/revoke', 200, 'ok');
      setResponseForUrl('/device/code', 200, DEVICE_CODE_RESPONSE);
      setResponseForUrl('/device/token', 400, { error: 'access_denied' });

      const result = await runProdCli(
        'auth',
        'login',
        '--client-name',
        'Denied Agent',
        '--interval',
        '1',
        '--timeout',
        '5',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('denied');
    });
  });

  describe('auth logout', () => {
    it('sends POST to /device/revoke with refresh token then clears auth', async () => {
      setResponseForUrl('/device/revoke', 200, 'ok');

      const result = await runProdCli('auth', 'logout', '--format', 'json');

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as Record<string, unknown>;
      expect(parsed.authenticated).toBe(false);

      const revokeRequest = requests.find((r) =>
        r.url.includes('/device/revoke'),
      );
      expect(revokeRequest).toBeDefined();
      expect(revokeRequest?.method).toBe('POST');
      const params = new URLSearchParams(revokeRequest?.body);
      expect(params.get('token')).toBe(PROD_AUTH_TOKENS.refresh_token);
      expect(params.get('client_id')).toBe('lwlpk_U7Qy7ThG69STZk');
    });

    it('clears local auth even when revoke call fails', async () => {
      setResponseForUrl('/device/revoke', 500, {
        error: 'server_error',
      });

      const result = await runProdCli('auth', 'logout', '--format', 'json');

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as Record<string, unknown>;
      expect(parsed.authenticated).toBe(false);
    });

    it('succeeds when no auth tokens are stored', async () => {
      storage.clearAuth();

      const result = await runProdCli('auth', 'logout', '--format', 'json');

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as Record<string, unknown>;
      expect(parsed.authenticated).toBe(false);
      const revokeRequest = requests.find((r) =>
        r.url.includes('/device/revoke'),
      );
      expect(revokeRequest).toBeUndefined();
    });
  });

  describe('auth guard', () => {
    it('rejects unauthenticated requests before hitting the API', async () => {
      storage.clearAuth();

      const result = await runProdCli(
        'spend-request',
        'create',
        '--payment-method-id',
        'pd_test',
        '-m',
        'Nike',
        '--merchant-url',
        'https://example.com',
        '--context',
        VALID_CONTEXT,
        '--amount',
        '5000',
        '--no-request-approval',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toContain('Not authenticated');
    });
  });

  describe('LINK_ACCESS_TOKEN', () => {
    const ENV_TOKEN = 'env_access_token_abc123';

    beforeEach(() => {
      storage.clearAuth();
    });

    it('allows user-info retrieve with no stored auth', async () => {
      setResponseForUrl('/userinfo', 200, {
        email: 'user@example.com',
        name: 'Test User',
      });

      const result = await runProdCliWithEnv(
        { LINK_ACCESS_TOKEN: ENV_TOKEN },
        'user-info',
        'retrieve',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = parseJson(result.stdout) as Record<string, unknown>;
      expect(output.email).toBe('user@example.com');
      const userInfoRequest = requests.find((r) => r.url === '/userinfo');
      expect(userInfoRequest).toBeDefined();
      expect(userInfoRequest?.headers.authorization).toBe(
        `Bearer ${ENV_TOKEN}`,
      );
    });

    it('allows spend-request list with no stored auth', async () => {
      setNextResponse(200, { data: [] });

      const result = await runProdCliWithEnv(
        { LINK_ACCESS_TOKEN: ENV_TOKEN },
        'spend-request',
        'list',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const spendRequest = requests.find((r) => r.url === '/spend_requests');
      expect(spendRequest).toBeDefined();
      expect(spendRequest?.headers.authorization).toBe(`Bearer ${ENV_TOKEN}`);
    });

    it('allows payment-methods list with no stored auth', async () => {
      setResponseForUrl('/payment-details', 200, { payment_details: [] });

      const result = await runProdCliWithEnv(
        { LINK_ACCESS_TOKEN: ENV_TOKEN },
        'payment-methods',
        'list',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const pmRequest = requests.find((r) => r.url === '/payment-details');
      expect(pmRequest).toBeDefined();
      expect(pmRequest?.headers.authorization).toBe(`Bearer ${ENV_TOKEN}`);
    });

    it('allows shipping-address list with no stored auth', async () => {
      setResponseForUrl('/shipping_addresses', 200, { shipping_addresses: [] });

      const result = await runProdCliWithEnv(
        { LINK_ACCESS_TOKEN: ENV_TOKEN },
        'shipping-address',
        'list',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const saRequest = requests.find((r) => r.url === '/shipping_addresses');
      expect(saRequest).toBeDefined();
      expect(saRequest?.headers.authorization).toBe(`Bearer ${ENV_TOKEN}`);
    });

    it('allows transactions list with no stored auth', async () => {
      setResponseForUrl('/transactions', 200, { data: [] });

      const result = await runProdCliWithEnv(
        { LINK_ACCESS_TOKEN: ENV_TOKEN },
        'transactions',
        'list',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const txnRequest = requests.find((r) => r.url === '/transactions');
      expect(txnRequest).toBeDefined();
      expect(txnRequest?.headers.authorization).toBe(`Bearer ${ENV_TOKEN}`);
    });

    it('still blocks commands with neither stored auth nor env token', async () => {
      const result = await runProdCliWithEnv(
        {},
        'user-info',
        'retrieve',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('Not authenticated');
      const userInfoRequest = requests.find((r) => r.url === '/userinfo');
      expect(userInfoRequest).toBeUndefined();
    });
  });

  describe('mpp pay', () => {
    const APPROVED_SPT_REQUEST = {
      ...BASE_REQUEST,
      id: 'lsrq_spt_001',
      status: 'approved',
      credential_type: 'shared_payment_token',
      shared_payment_token: 'spt_test_abc123',
      network_id: 'net_001',
    };

    const WWW_AUTHENTICATE_STRIPE = [
      'Payment id="ch_001",',
      'realm="127.0.0.1",',
      'method="stripe",',
      'intent="charge",',
      `request="${Buffer.from(JSON.stringify({ networkId: 'net_001', amount: '1000', currency: 'usd', decimals: 2, paymentMethodTypes: ['card'] })).toString('base64')}",`,
      'expires="2099-01-01T00:00:00Z"',
    ].join(' ');

    const WWW_AUTHENTICATE_MULTI = [
      'Payment id="tempo_001",',
      'realm="127.0.0.1",',
      'method="tempo",',
      'intent="charge",',
      'request="e30=",',
      'Payment id="ch_001",',
      'realm="127.0.0.1",',
      'method="stripe",',
      'intent="charge",',
      `request="${Buffer.from(JSON.stringify({ networkId: 'net_001', amount: '1000', currency: 'usd', decimals: 2, paymentMethodTypes: ['card'] })).toString('base64')}",`,
      'expires="2099-01-01T00:00:00Z"',
    ].join(' ');

    const WWW_AUTHENTICATE_STRIPE_SESSION = [
      'Payment id="sess_001",',
      'realm="127.0.0.1",',
      'method="stripe",',
      'intent="session",',
      `request="${Buffer.from(JSON.stringify({ networkId: 'net_001', amount: '1000', currency: 'usd', decimals: 2, paymentMethodTypes: ['card'] })).toString('base64')}",`,
      'expires="2099-01-01T00:00:00Z"',
    ].join(' ');

    function decodeCredential(authorizationHeader: string): {
      challenge: { intent: string };
      payload: Record<string, unknown>;
    } {
      const encoded = authorizationHeader.replace(/^Payment\s+/i, '');
      return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    }

    it('happy path: probes, gets 402, signs, retries, returns response', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(402, '{"error":"payment required"}', {
        'www-authenticate': WWW_AUTHENTICATE_STRIPE,
      });
      setMerchantResponse(200, '{"success":true}');

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/charge`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as {
        status: number;
        body: string;
      };
      expect(parsed.status).toBe(200);
      expect(parsed.body).toContain('success');
      expect(merchantRequests).toHaveLength(2);
      expect(merchantRequests[1].headers.authorization).toMatch(/^Payment /);
    });

    it('returns structured response when the paid retry fails', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(402, '{"error":"payment required"}', {
        'www-authenticate': WWW_AUTHENTICATE_STRIPE,
      });
      setMerchantResponse(401, '{"error":"spt rejected"}');

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/charge`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--format',
        'json',
      );

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as {
        status: number;
        headers: Record<string, string>;
        body: string;
      };
      expect(parsed.status).toBe(401);
      expect(parsed.body).toContain('spt rejected');
      expect(merchantRequests).toHaveLength(2);
    });

    it('selects the stripe challenge when the response advertises multiple methods', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(402, '{"error":"payment required"}', {
        'www-authenticate': WWW_AUTHENTICATE_MULTI,
      });
      setMerchantResponse(200, '{"success":true}');

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/charge`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--format',
        'json',
      );

      expect(result.exitCode).toBe(0);
      expect(merchantRequests).toHaveLength(2);
      expect(merchantRequests[1].headers.authorization).toMatch(/^Payment /);
    });

    it('signs a stripe session challenge with an open/grantedToken credential', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(402, '{"error":"payment required"}', {
        'www-authenticate': WWW_AUTHENTICATE_STRIPE_SESSION,
      });
      setMerchantResponse(200, '{"success":true}');

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/session`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--format',
        'json',
      );

      expect(result.exitCode).toBe(0);
      expect(merchantRequests).toHaveLength(2);
      const authorization = merchantRequests[1].headers.authorization as string;
      expect(authorization).toMatch(/^Payment /);
      const credential = decodeCredential(authorization);
      expect(credential.challenge.intent).toBe('session');
      expect(credential.payload).toEqual({
        action: 'open',
        grantedToken: 'spt_test_abc123',
      });
    });

    it('passthrough: no 402 returns response without signing', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(200, '{"ok":true}');

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as { status: number };
      expect(parsed.status).toBe(200);
      expect(merchantRequests).toHaveLength(1);
    });

    it('no stripe challenge in 402 exits 1 with error', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(402, '{"error":"payment required"}', {
        'www-authenticate':
          'Payment id="x", realm="r", method="tempo", intent="charge", request="e30="',
      });

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/stripe/i);
    });

    it('spend request not approved exits 1 with error', async () => {
      setNextResponse(200, {
        ...APPROVED_SPT_REQUEST,
        status: 'pending_approval',
      });

      const result = await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/approved/i);
    });

    it('sends POST with data when --data is provided', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(200, '{"ok":true}');

      await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--data',
        '{"amount":100}',
        '--json',
      );

      expect(merchantRequests[0].method).toBe('POST');
      expect(merchantRequests[0].body).toBe('{"amount":100}');
    });

    it('sends custom headers provided via --header', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(200, '{"ok":true}');

      await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--header',
        'X-Custom-Header: hello',
        '--header',
        'X-Another: world',
        '--json',
      );

      expect(merchantRequests[0].headers['x-custom-header']).toBe('hello');
      expect(merchantRequests[0].headers['x-another']).toBe('world');
    });

    it('auto-applies Content-Type application/json when --data is provided', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(200, '{"ok":true}');

      await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--data',
        '{"amount":100}',
        '--json',
      );

      expect(merchantRequests[0].headers['content-type']).toContain(
        'application/json',
      );
    });

    it('custom --header overrides auto Content-Type', async () => {
      setNextResponse(200, APPROVED_SPT_REQUEST);
      setMerchantResponse(200, '{"ok":true}');

      await runProdCli(
        'mpp',
        'pay',
        `http://127.0.0.1:${merchantPort}/api/endpoint`,
        '--spend-request-id',
        'lsrq_spt_001',
        '--data',
        'hello',
        '--header',
        'Content-Type: text/plain',
        '--json',
      );

      expect(merchantRequests[0].headers['content-type']).toContain(
        'text/plain',
      );
    });
  });

  describe('mpp decode', () => {
    const WWW_AUTHENTICATE_MULTI = [
      'Bearer realm="merchant.example",',
      'Payment id="tempo_001", realm="merchant.example", method="tempo", intent="charge", request="e30=",',
      'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge",',
      `request="${Buffer.from(
        JSON.stringify({
          networkId: 'net_001',
          amount: '1000',
          currency: 'usd',
          decimals: 2,
          paymentMethodTypes: ['card'],
        }),
      ).toString('base64')}"`,
    ].join(' ');

    it('decodes the stripe challenge and extracts network_id', async () => {
      const result = await runProdCli(
        'mpp',
        'decode',
        '--challenge',
        WWW_AUTHENTICATE_MULTI,
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const parsed = parseJson(result.stdout) as {
        method: string;
        intent: string;
        network_id: string;
        request_json: Record<string, unknown>;
      };
      expect(parsed.method).toBe('stripe');
      expect(parsed.intent).toBe('charge');
      expect(parsed.network_id).toBe('net_001');
      expect(parsed.request_json.networkId).toBe('net_001');
    });

    it('fails when the stripe challenge payload is invalid', async () => {
      const invalidChallenge = [
        'Payment id="ch_001",',
        'realm="merchant.example",',
        'method="stripe",',
        'intent="charge",',
        `request="${Buffer.from(
          JSON.stringify({
            amount: '1000',
            currency: 'usd',
            decimals: 2,
            paymentMethodTypes: ['card'],
          }),
        ).toString('base64')}"`,
      ].join(' ');

      const result = await runProdCli(
        'mpp',
        'decode',
        '--challenge',
        invalidChallenge,
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/networkId/i);
    });
  });
});
