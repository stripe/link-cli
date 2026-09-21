import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI_PATH = new URL('../../dist/cli.js', import.meta.url).pathname;

const VICTIM_TOKEN = 'victim_test_token_123';
const REQUEST_TIMEOUT_MS = 2_000;

interface ApiRequestLog {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

let mockApi: http.Server;
let mockApiPort: number;
let apiRequests: ApiRequestLog[];
let cli: ChildProcess | undefined;
let servePort: number;

function listen(server: http.Server, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve((server.address() as { port: number }).port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// Grab an ephemeral port, then release it so serve can bind it.
async function freePort(): Promise<number> {
  const tmp = http.createServer();
  const port = await listen(tmp);
  await closeServer(tmp);
  return port;
}

function waitForListening(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(
      () => reject(new Error(`serve did not start\n${stderr}`)),
      10_000,
    );
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.includes('link-cli MCP server listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`serve exited early code=${code} signal=${signal}`));
    });
  });
}

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// Pass the target directly to node:http: fetch would normalize attack paths
// before they ever reach the server, hiding the parser differential.
function request(
  target: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: servePort,
        path: target,
        method: options.method ?? 'GET',
        headers: options.headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy(new Error(`Request timed out: ${target}`));
    }, REQUEST_TIMEOUT_MS);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(options.body);
  });
}

async function initializeMcp(target = '/mcp') {
  const res = await request(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'serve-security-test', version: '1.0.0' },
      },
    }),
  });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    result: { serverInfo: { name: 'link-cli' } },
  });
  return res;
}

async function stopCli(child: ChildProcess): Promise<void> {
  // An already-exited child never emits another exit event. In particular,
  // malformed-target regressions must fail without hanging test teardown.
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('serve did not exit after SIGTERM'));
    }, REQUEST_TIMEOUT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

describe('serve command security', () => {
  beforeEach(async () => {
    apiRequests = [];
    mockApi = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        apiRequests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    mockApiPort = await listen(mockApi);
    servePort = await freePort();

    cli = spawn('node', [CLI_PATH, 'serve', '--port', String(servePort)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LINK_ACCESS_TOKEN: VICTIM_TOKEN,
        LINK_NO_REFRESH: '1',
        LINK_API_BASE_URL: `http://127.0.0.1:${mockApiPort}`,
        LINK_AUTH_BASE_URL: `http://127.0.0.1:${mockApiPort}`,
        NO_UPDATE_NOTIFIER: '1',
      },
    });
    await waitForListening(cli);
  });

  afterEach(async () => {
    try {
      if (cli) await stopCli(cli);
    } finally {
      cli = undefined;
      await closeServer(mockApi);
    }
  });

  it('404s an arbitrary CLI command path and never uses the token', async () => {
    const res = await request('/user-info/retrieve');
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(apiRequests).toHaveLength(0);
  });

  it('404s a state-changing command path and never uses the token', async () => {
    const res = await request('/spend-request/update/spr_poc_123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 4242 }),
    });
    expect(res.status).toBe(404);
    expect(apiRequests).toHaveLength(0);
  });

  it.each([
    ['GET', '//serve/mcp'],
    ['GET', '///serve/mcp'],
    ['POST', '//serve/mcp'],
  ])(
    'rejects %s %s without opening another listener',
    async (method, target) => {
      const otherPort = await freePort();
      const res = await request(`${target}?host=127.0.0.1&port=${otherPort}`, {
        method,
        headers:
          method === 'POST'
            ? { 'Content-Type': 'application/json' }
            : undefined,
        body:
          method === 'POST'
            ? JSON.stringify({ host: '127.0.0.1', port: otherPort })
            : undefined,
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'bad request' });

      // Binding the attacker's requested port proves serve did not open it.
      // The target is always an ephemeral loopback port, even on a regression.
      const probe = http.createServer();
      try {
        await listen(probe, otherPort);
      } finally {
        await closeServer(probe);
      }
      await initializeMcp();
      expect(apiRequests).toHaveLength(0);
    },
  );

  it('rejects command targets without reporting under the wallet bearer', async () => {
    for (const target of [
      '//report/mcp',
      '///report/mcp',
      '//report/mcp/../mcp',
      '//report/.well-known/skills/index.json',
    ]) {
      const res = await request(
        `${target}?domain=marker.example.invalid&outcome=success&spendRequestId=lsrq_test`,
      );
      expect(res.status, target).toBe(400);
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('rejects ambiguous request paths before dispatch', async () => {
    const otherPort = await freePort();
    for (const target of [
      '//a@b/mcp',
      '//serve/mcp/../mcp',
      '//spend-request/.well-known/skills/x',
      '/\\serve/mcp',
      '/serve\\mcp',
      '/%2fserve/mcp',
      '/%2Fserve/mcp',
      '/%5cserve/mcp',
      '/%5Cserve/mcp',
      '/serve%2fmcp',
      '/serve%5cmcp',
      '/serve/../mcp',
      '/./mcp',
      '/serve/%2e%2e/mcp',
      '/serve/%2E./mcp',
      '/serve/.%2e/mcp',
      '/%2e/mcp',
      '/mcp#ignored',
      '/mcp?query=value#ignored',
      'http://localhost/mcp',
      'https://localhost/mcp',
      '*',
    ]) {
      const safeTarget = target.includes('serve')
        ? `${target}?host=127.0.0.1&port=${otherPort}`
        : target;
      const res = await request(safeTarget);
      expect(res.status, target).toBe(400);
      expect(JSON.parse(res.body), target).toEqual({ error: 'bad request' });
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('returns 400 for malformed authorities and keeps serving MCP', async () => {
    for (const target of [
      '//[/mcp',
      '//a%2fb/mcp',
      '//%2f/mcp',
      '//a%5cb/mcp',
    ]) {
      const res = await request(target);
      expect(res.status, target).toBe(400);
      expect(JSON.parse(res.body), target).toEqual({ error: 'bad request' });
      await initializeMcp();
      expect(cli?.exitCode).toBeNull();
      expect(cli?.signalCode).toBeNull();
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('serves MCP initialize without an Origin and allows separators in query values', async () => {
    const res = await initializeMcp();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await initializeMcp(
      '/mcp?url=https%3A%2F%2Fexample.invalid%2F&path=%5C&dots=%2e%2e',
    );
    expect(apiRequests).toHaveLength(0);
  });

  it.each(['GET', 'HEAD', 'DELETE', 'PUT', 'PATCH'])(
    'returns 405 for %s /mcp before dispatch',
    async (method) => {
      const res = await request('/mcp', { method });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST, OPTIONS');
      expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
      expect(apiRequests).toHaveLength(0);
    },
  );

  it('serves skills discovery and the advertised SKILL.md files', async () => {
    const res = await request('/.well-known/skills/index.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const { skills } = JSON.parse(res.body) as { skills: { name: string }[] };
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      const markdown = await request(
        `/.well-known/skills/${skill.name}/SKILL.md`,
      );
      expect(markdown.status, skill.name).toBe(200);
      expect(markdown.headers['content-type']).toContain('text/markdown');
      expect(markdown.body).toContain('---\n');
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('restricts skills routes to GET and OPTIONS', async () => {
    for (const target of [
      '/.well-known/skills/index.json',
      '/.well-known/skills/link-cli/SKILL.md',
    ]) {
      const preflight = await request(target, { method: 'OPTIONS' });
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-methods']).toBe(
        'GET, OPTIONS',
      );
      for (const method of ['POST', 'HEAD', 'DELETE']) {
        const res = await request(target, { method });
        expect(res.status, `${method} ${target}`).toBe(405);
        expect(res.headers.allow).toBe('GET, OPTIONS');
      }
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('returns 404 for unknown routes, including preflight requests', async () => {
    for (const target of [
      '/serve/mcp',
      '/report/mcp',
      '/mcp/extra',
      '/.well-known/skills/',
      '/.well-known/skills/unknown',
      '/.well-known/skills/index.json/extra',
      '/.well-known/skills/link-cli/extra/SKILL.md',
    ]) {
      for (const method of ['GET', 'OPTIONS']) {
        const res = await request(target, { method });
        expect(res.status, `${method} ${target}`).toBe(404);
      }
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('rejects disallowed and null origins with 403', async () => {
    for (const origin of [
      'https://attacker.example',
      'http://attacker.example',
      'null',
    ]) {
      for (const method of ['GET', 'POST', 'OPTIONS']) {
        const res = await request('/mcp', {
          method,
          headers: { Origin: origin },
        });
        expect(res.status, `${method} ${origin}`).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    }
    expect(apiRequests).toHaveLength(0);
  });

  it('allows loopback browser origins without wildcard CORS', async () => {
    const res = await request('/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(res.headers.vary).toBe('Origin');
  });
});
