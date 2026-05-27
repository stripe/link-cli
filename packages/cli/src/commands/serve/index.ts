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

export function createServeCli(rootCli: {
  fetch: (req: Request) => Promise<Response>;
}) {
  return Cli.create('serve', {
    description:
      'Start an HTTP server exposing link-cli as an MCP endpoint at /mcp',
    options: z.object({
      port: z.coerce.number().default(54321).describe('Port to listen on'),
    }),
    async run(c) {
      const { port } = c.options;

      const server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
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

          try {
            const webReq = await nodeRequestToWebRequest(req, port);
            const webRes = await rootCli.fetch(webReq);
            await sendWebResponse(webRes, res);
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        },
      );

      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, () => {
          process.stderr.write(
            `link-cli MCP server listening on http://localhost:${port}/mcp\n`,
          );
        });
      });
    },
  });
}
