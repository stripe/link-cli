import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CallbackResult {
  approved: boolean;
}

export interface CallbackServer {
  redirectUri: string;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}

export function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCallback: ((result: CallbackResult) => void) | undefined;
    const callbackPromise = new Promise<CallbackResult>((res) => {
      resolveCallback = res;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const approved = url.searchParams.get('status') === 'approved';
      res.writeHead(200).end();
      resolveCallback?.({ approved });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        redirectUri: `http://localhost:${port}/callback`,
        waitForCallback: () => callbackPromise,
        close: () => server.close(),
      });
    });

    server.on('error', reject);
  });
}
