import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CallbackStatus = 'approved' | 'denied' | 'expired' | 'error';

export interface CallbackResult {
  status: CallbackStatus;
}

export interface CallbackServer {
  redirectUri: string;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => void;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'approved',
  'denied',
  'expired',
  'error',
]);

const STATUS_MESSAGES: Record<string, string> = {
  approved: 'Spend request approved. You can close this tab.',
  denied: 'Spend request denied. You can close this tab.',
  expired: 'Spend request expired. You can close this tab.',
};

export function startCallbackServer(): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let resolveCallback: ((result: CallbackResult) => void) | undefined;
    const callbackPromise = new Promise<CallbackResult>((res) => {
      resolveCallback = res;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const raw = url.searchParams.get('status') ?? '';
      const status: CallbackStatus = VALID_STATUSES.has(raw)
        ? (raw as CallbackStatus)
        : 'error';
      const message =
        STATUS_MESSAGES[raw] ?? 'Something went wrong. You can close this tab.';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><p>${message}</p></body></html>`);
      resolveCallback?.({ status });
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
