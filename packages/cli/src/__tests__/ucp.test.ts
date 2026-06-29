import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const CLI_PATH = new URL('../../dist/cli.js', import.meta.url).pathname;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RequestLog {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let serverPort: number;
let requests: RequestLog[];
let responsesByUrl: Record<
  string,
  { status: number; body: unknown; headers?: Record<string, string> }
>;

function discoveryResponse(port: number) {
  return {
    ucp: {
      version: '2026-04-08',
      services: {
        'dev.ucp.shopping': [
          {
            version: '1.0',
            spec: 'ucp',
            transport: 'rest',
            endpoint: `http://127.0.0.1:${port}/ucp/rest`,
          },
        ],
      },
      capabilities: {
        'dev.ucp.catalog': [{ version: '1.0', spec: 'ucp' }],
        'dev.ucp.cart': [{ version: '1.0', spec: 'ucp' }],
        'dev.ucp.checkout': [{ version: '1.0', spec: 'ucp' }],
      },
      payment_handlers: {},
    },
  };
}

async function runCli(...args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [CLI_PATH, ...args],
      {
        env: {
          ...process.env,
          XDG_DATA_HOME: '/tmp/link-cli-ucp-test',
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

describe('ucp commands', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });

        const match = responsesByUrl[req.url ?? ''];
        if (match) {
          res.writeHead(match.status, {
            'Content-Type': 'application/json',
            ...match.headers,
          });
          res.end(JSON.stringify(match.body));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests = [];
    responsesByUrl = {
      '/.well-known/ucp': {
        status: 200,
        body: discoveryResponse(serverPort),
      },
    };
  });

  describe('discover', () => {
    it('returns discovery info as JSON', async () => {
      const result = await runCli(
        'ucp',
        'discover',
        `http://127.0.0.1:${serverPort}`,
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.business).toBe(`http://127.0.0.1:${serverPort}`);
      expect(output.rest_endpoint).toBe(
        `http://127.0.0.1:${serverPort}/ucp/rest`,
      );
      expect(output.capabilities).toContain('dev.ucp.catalog');
    });

    it('fails gracefully when discovery endpoint is unavailable', async () => {
      responsesByUrl['/.well-known/ucp'] = { status: 503, body: {} };

      const result = await runCli(
        'ucp',
        'discover',
        `http://127.0.0.1:${serverPort}`,
        '--json',
      );

      expect(result.exitCode).toBe(1);
      const output = JSON.parse(result.stdout);
      expect(output.message).toMatch(/Discovery failed/);
    });
  });

  describe('catalog search', () => {
    it('sends search request and returns results', async () => {
      responsesByUrl['/ucp/rest/catalog/search'] = {
        status: 200,
        body: { products: [{ id: 'prod_1', name: 'Red Boots' }] },
      };

      const result = await runCli(
        'ucp',
        'catalog',
        'search',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--query',
        'boots',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.products).toHaveLength(1);
      expect(output.products[0].name).toBe('Red Boots');

      const searchReq = requests.find((r) => r.url === '/ucp/rest/catalog/search');
      expect(searchReq).toBeDefined();
      expect(searchReq!.method).toBe('POST');
      expect(JSON.parse(searchReq!.body)).toEqual({ query: 'boots' });
    });

    it('sends auth headers when --client-id and --client-secret are provided', async () => {
      responsesByUrl['/ucp/rest/catalog/search'] = {
        status: 200,
        body: { products: [] },
      };

      await runCli(
        'ucp',
        'catalog',
        'search',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--client-id',
        'test_client',
        '--client-secret',
        'test_secret',
        '--query',
        'shoes',
        '--json',
      );

      const searchReq = requests.find((r) => r.url === '/ucp/rest/catalog/search');
      expect(searchReq).toBeDefined();
      const expected = `Basic ${btoa('test_client:test_secret')}`;
      expect(searchReq!.headers.authorization).toBe(expected);
    });

    it('sends Bearer token when --access-token is provided', async () => {
      responsesByUrl['/ucp/rest/catalog/search'] = {
        status: 200,
        body: { products: [] },
      };

      await runCli(
        'ucp',
        'catalog',
        'search',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--access-token',
        'tok_user_123',
        '--query',
        'hats',
        '--json',
      );

      const searchReq = requests.find((r) => r.url === '/ucp/rest/catalog/search');
      expect(searchReq!.headers.authorization).toBe('Bearer tok_user_123');
    });

    it('fails when --profile-url is missing', async () => {
      const result = await runCli(
        'ucp',
        'catalog',
        'search',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--query',
        'boots',
        '--json',
      );

      expect(result.exitCode).toBe(1);
    });
  });

  describe('catalog lookup', () => {
    it('sends lookup request with IDs', async () => {
      responsesByUrl['/ucp/rest/catalog/lookup'] = {
        status: 200,
        body: { products: [{ id: 'prod_1' }, { id: 'prod_2' }] },
      };

      const result = await runCli(
        'ucp',
        'catalog',
        'lookup',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--ids',
        'prod_1,prod_2',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.products).toHaveLength(2);

      const lookupReq = requests.find((r) => r.url === '/ucp/rest/catalog/lookup');
      expect(JSON.parse(lookupReq!.body)).toEqual({ ids: ['prod_1', 'prod_2'] });
    });
  });

  describe('cart', () => {
    it('create sends POST to /carts', async () => {
      responsesByUrl['/ucp/rest/carts'] = {
        status: 200,
        body: {
          id: 'cart_1',
          line_items: [{ item: { id: 'var_1' }, quantity: 1 }],
        },
      };

      const result = await runCli(
        'ucp',
        'cart',
        'create',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--line-items',
        JSON.stringify([{ item: { id: 'var_1' }, quantity: 1 }]),
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.id).toBe('cart_1');

      const cartReq = requests.find((r) => r.url === '/ucp/rest/carts');
      expect(cartReq!.method).toBe('POST');
    });

    it('get fetches cart by ID', async () => {
      responsesByUrl['/ucp/rest/carts/cart_1'] = {
        status: 200,
        body: { id: 'cart_1', line_items: [] },
      };

      const result = await runCli(
        'ucp',
        'cart',
        'get',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--id',
        'cart_1',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.id).toBe('cart_1');

      const getReq = requests.find((r) => r.url === '/ucp/rest/carts/cart_1');
      expect(getReq!.method).toBe('GET');
    });

    it('update sends PUT to /carts/{id}', async () => {
      responsesByUrl['/ucp/rest/carts/cart_1'] = {
        status: 200,
        body: { id: 'cart_1', line_items: [{ item: { id: 'var_2' }, quantity: 3 }] },
      };

      const result = await runCli(
        'ucp',
        'cart',
        'update',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--id',
        'cart_1',
        '--line-items',
        JSON.stringify([{ item: { id: 'var_2' }, quantity: 3 }]),
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const putReq = requests.find(
        (r) => r.url === '/ucp/rest/carts/cart_1' && r.method === 'PUT',
      );
      expect(putReq).toBeDefined();
    });
  });

  describe('checkout', () => {
    it('create sends POST to /checkout-sessions', async () => {
      responsesByUrl['/ucp/rest/checkout-sessions'] = {
        status: 200,
        body: { id: 'cs_1', status: 'open' },
      };

      const result = await runCli(
        'ucp',
        'checkout',
        'create',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--cart-id',
        'cart_1',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.id).toBe('cs_1');

      const createReq = requests.find((r) => r.url === '/ucp/rest/checkout-sessions');
      expect(createReq!.method).toBe('POST');
      expect(JSON.parse(createReq!.body)).toMatchObject({ cart_id: 'cart_1' });
    });

    it('get fetches checkout by ID', async () => {
      responsesByUrl['/ucp/rest/checkout-sessions/cs_1'] = {
        status: 200,
        body: { id: 'cs_1', status: 'open' },
      };

      const result = await runCli(
        'ucp',
        'checkout',
        'get',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--id',
        'cs_1',
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.id).toBe('cs_1');
    });

    it('complete sends POST to /checkout-sessions/{id}/complete', async () => {
      responsesByUrl['/ucp/rest/checkout-sessions/cs_1/complete'] = {
        status: 200,
        body: { id: 'cs_1', status: 'completed', order_id: 'ord_1' },
      };

      const result = await runCli(
        'ucp',
        'checkout',
        'complete',
        '--business',
        `http://127.0.0.1:${serverPort}`,
        '--profile-url',
        'https://agent.example/profile.json',
        '--id',
        'cs_1',
        '--input',
        JSON.stringify({ payment_method: 'pm_1' }),
        '--json',
      );

      expect(result.exitCode).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.order_id).toBe('ord_1');

      const completeReq = requests.find(
        (r) => r.url === '/ucp/rest/checkout-sessions/cs_1/complete',
      );
      expect(completeReq!.method).toBe('POST');
    });
  });
});
