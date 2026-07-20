import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI_PATH = new URL('../../dist/cli.js', import.meta.url).pathname;

const VICTIM_TOKEN = 'victim_test_token_123';

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

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
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
    if (cli && !cli.killed) {
      cli.kill('SIGTERM');
      await new Promise<void>((resolve) => cli?.once('exit', () => resolve()));
    }
    cli = undefined;
    await closeServer(mockApi);
  });

  it('404s an arbitrary CLI command path and never uses the token', async () => {
    const res = await fetch(
      `http://127.0.0.1:${servePort}/user-info/retrieve`,
      { headers: { Accept: 'application/json' } },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(apiRequests).toHaveLength(0);
  });

  it('404s a state-changing command path and never uses the token', async () => {
    const res = await fetch(
      `http://127.0.0.1:${servePort}/spend-request/update/spr_poc_123`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 4242 }),
      },
    );
    expect(res.status).toBe(404);
    expect(apiRequests).toHaveLength(0);
  });

  it('routes /mcp to the MCP transport (not gated as 404)', async () => {
    const res = await fetch(`http://127.0.0.1:${servePort}/mcp`, {
      headers: { Accept: 'application/json, text/event-stream' },
    });
    expect(res.status).not.toBe(404);
  });

  it('rejects cross-origin requests with 403', async () => {
    const res = await fetch(`http://127.0.0.1:${servePort}/mcp`, {
      headers: { Origin: 'https://attacker.example' },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(apiRequests).toHaveLength(0);
  });

  it('allows loopback browser origins without wildcard CORS', async () => {
    const res = await fetch(`http://127.0.0.1:${servePort}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    );
  });
});
