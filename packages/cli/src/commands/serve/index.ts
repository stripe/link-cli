import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { Cli, z } from 'incur';

async function nodeRequestToWebRequest(
  req: IncomingMessage,
  port: number,
): Promise<Request> {
  const body = await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    headers.set(key, Array.isArray(val) ? val.join(', ') : val);
  }

  const method = req.method ?? 'GET';
  return new Request(`http://localhost:${port}${req.url ?? '/'}`, {
    method,
    headers,
    body: ['GET', 'HEAD'].includes(method)
      ? undefined
      : body.length > 0
        ? new Uint8Array(body)
        : undefined,
  });
}

async function sendWebResponse(
  webRes: Response,
  res: ServerResponse,
): Promise<void> {
  webRes.headers.forEach((val, key) => res.setHeader(key, val));
  const buffer = await webRes.arrayBuffer();
  res.writeHead(webRes.status);
  res.end(Buffer.from(buffer));
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

// Returns true when the request's Origin is safe to serve. Requests without an
// Origin (non-browser callers such as MCP clients or curl) are allowed; browser
// requests are only allowed from loopback origins.
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// Only the MCP transport (/mcp) and Agent Skills discovery
// (/.well-known/skills/, GET) are intentionally exposed.
function isAllowedRoute(method: string, pathname: string): boolean {
  if (pathname === '/mcp') return true;
  if (pathname.startsWith('/.well-known/skills/') && method === 'GET')
    return true;
  return false;
}

export function createServeCli(rootCli: {
  fetch: (req: Request) => Promise<Response>;
}) {
  return Cli.create('serve', {
    description:
      'Start an HTTP server exposing link-cli as an MCP endpoint at /mcp',
    options: z.object({
      port: z.coerce.number().default(54321).describe('Port to listen on'),
      host: z
        .string()
        .default('127.0.0.1')
        .describe(
          'Host/interface to bind. Defaults to loopback; set explicitly (e.g. 0.0.0.0) to expose beyond localhost.',
        ),
    }),
    async run(c) {
      const { port, host } = c.options;

      const server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          const origin = req.headers.origin;

          if (!isAllowedOrigin(origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'forbidden origin' }));
            return;
          }

          // Reflect the specific allowed origin (never `*`) so responses stay
          // scoped to loopback browser callers.
          if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
          }
          res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, DELETE, OPTIONS',
          );
          res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Accept, Mcp-Session-Id',
          );

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          const pathname = new URL(req.url ?? '/', `http://localhost:${port}`)
            .pathname;
          if (!isAllowedRoute(req.method ?? 'GET', pathname)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }

          try {
            const webReq = await nodeRequestToWebRequest(req, port);
            const webRes = await rootCli.fetch(webReq);
            await sendWebResponse(webRes, res);
          } catch (err) {
            console.error('Request handling failed:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        },
      );

      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => {
          if (!isLoopbackHost(host)) {
            process.stderr.write(
              `WARNING: link-cli serve is bound to ${host}, which may be reachable beyond localhost.\nAny caller that can reach this port can use the authenticated Link session of this CLI. Only do this on a trusted, isolated network.\n`,
            );
          }
          process.stderr.write(
            `link-cli MCP server listening on http://${host}:${port}/mcp\n`,
          );
        });
      });
    },
  });
}
