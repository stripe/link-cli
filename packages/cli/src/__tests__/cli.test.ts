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
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          LINK_API_BASE_URL: `http://127.0.0.1:${serverPort}`,
          LINK_AUTH_BASE_URL: `http://127.0.0.1:${serverPort}`,
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
          valid_until: 1750000000,
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
      expect(card.valid_until).toBe(1750000000);
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

    it('sends client_hint and returns immediately with _next polling hint', async () => {
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

      // Returns immediately with verification URL and _next hint
      const output = parseJson(result.stdout) as Record<string, unknown>[];
      expect(output.length).toBe(1);
      expect(output[0].verification_url).toBe(
        'https://app.link.com/device/setup?code=apple-grape',
      );
      expect(output[0].passphrase).toBe('apple-grape');
      const next = output[0]._next as Record<string, unknown>;
      expect(next.command).toContain('auth status');
      expect(next.until).toContain('authenticated');
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

    it('exits 1 when the paid retry fails', async () => {
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
        '--format', 'json',
      );

      expect(result.exitCode).toBe(1);
      const err = parseJson(result.stdout) as { message: string };
      expect(err.message).toContain('Payment submission failed with status 401');
      expect(err.message).toContain('spt rejected');
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
        '--format', 'json',
      );

      expect(result.exitCode).toBe(0);
      expect(merchantRequests).toHaveLength(2);
      expect(merchantRequests[1].headers.authorization).toMatch(/^Payment /);
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
