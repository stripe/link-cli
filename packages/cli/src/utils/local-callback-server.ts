import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type CallbackStatus = 'approved' | 'denied' | 'expired' | 'error' | 'timeout';

export interface CallbackResult {
  status: CallbackStatus;
}

export interface CallbackServer {
  redirectUri: string;
  waitForCallback: (timeoutMs?: number) => Promise<CallbackResult>;
  close: () => void;
}

// If no browser redirect arrives within this window, fall back to polling.
// Shorter than the approval window — polling recovers the result either way.
const DEFAULT_CALLBACK_TIMEOUT_MS = 2 * 60 * 1000;

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

export async function tryStartCallbackServer(): Promise<CallbackServer | null> {
  try {
    return await startCallbackServer();
  } catch {
    return null;
  }
}

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

    const startListening = (host: string, fallback?: string) => {
      server.listen(0, host, () => {
        const port = (server.address() as AddressInfo).port;
        resolve({
          redirectUri: `http://localhost:${port}/callback`,
          waitForCallback: (timeoutMs = DEFAULT_CALLBACK_TIMEOUT_MS) => {
            let timerId: ReturnType<typeof setTimeout>;
            const timeoutPromise = new Promise<CallbackResult>((res) => {
              timerId = setTimeout(() => res({ status: 'timeout' }), timeoutMs);
            });
            return Promise.race([callbackPromise, timeoutPromise]).finally(
              () => clearTimeout(timerId),
            );
          },
          close: () => server.close(),
        });
      });

      server.once('error', (err) => {
        if (fallback) {
          server.removeAllListeners('error');
          startListening(fallback);
        } else {
          reject(err);
        }
      });
    };

    startListening('::1', '127.0.0.1');
  });
}
