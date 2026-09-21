import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { Cli, z } from 'incur';

async function nodeRequestToWebRequest(
  req: IncomingMessage,
  target: URL,
): Promise<Request> {
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    headers.set(key, Array.isArray(val) ? val.join(', ') : val);
  }

  const method = req.method ?? 'GET';
  return new Request(target, {
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
  webRes.headers.forEach((val, key) => {
    res.setHeader(key, val);
  });
  const buffer = await webRes.arrayBuffer();
  res.writeHead(webRes.status);
  res.end(Buffer.from(buffer));
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

// Requests without an Origin are allowed for MCP clients and curl, but browsers
// can also omit Origin. The route and method checks must protect those requests.
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function parseRequestTarget(rawTarget: string, port: number): URL {
  // Accept only origin-form targets. Resolving //command/mcp against a base
  // treats "command" as the authority instead of a path segment.
  if (!rawTarget.startsWith('/') || rawTarget.startsWith('//')) {
    throw new Error('Invalid request target');
  }

  const pathname = rawTarget.split('?')[0];
  if (
    rawTarget.includes('#') ||
    pathname.includes('\\') ||
    /%(?:2f|5c)/i.test(pathname)
  ) {
    throw new Error('Invalid request target');
  }

  const target = new URL(rawTarget, `http://localhost:${port}`);
  // Reject paths changed by URL normalization, including dot segments and
  // encoded dot segments. Query values do not participate in routing.
  if (target.pathname !== pathname) {
    throw new Error('Invalid request target');
  }
  return target;
}

// The MCP transport is stateless, so it only serves POST. Skills discovery is
// read-only. Never forward other methods or arbitrary CLI command paths.
function allowedMethodsForRoute(pathname: string): string[] | undefined {
  if (pathname === '/mcp') return ['POST', 'OPTIONS'];
  if (
    pathname === '/.well-known/skills/index.json' ||
    /^\/\.well-known\/skills\/[^/]+\/SKILL\.md$/.test(pathname)
  ) {
    return ['GET', 'OPTIONS'];
  }
  return undefined;
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
          try {
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

            let target: URL;
            try {
              target = parseRequestTarget(req.url ?? '/', port);
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'bad request' }));
              return;
            }

            const allowedMethods = allowedMethodsForRoute(target.pathname);
            if (!allowedMethods) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'not found' }));
              return;
            }

            res.setHeader(
              'Access-Control-Allow-Methods',
              allowedMethods.join(', '),
            );
            res.setHeader(
              'Access-Control-Allow-Headers',
              'Content-Type, Accept, Mcp-Session-Id',
            );

            const method = req.method ?? 'GET';
            if (!allowedMethods.includes(method)) {
              res.writeHead(405, {
                'Content-Type': 'application/json',
                Allow: allowedMethods.join(', '),
              });
              res.end(JSON.stringify({ error: 'method not allowed' }));
              return;
            }

            if (method === 'OPTIONS') {
              res.writeHead(204);
              res.end();
              return;
            }

            const webReq = await nodeRequestToWebRequest(req, target);
            const webRes = await rootCli.fetch(webReq);
            await sendWebResponse(webRes, res);
          } catch (err) {
            console.error('Request handling failed:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        },
      );

      await new Promise<void>((_resolve, reject) => {
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
