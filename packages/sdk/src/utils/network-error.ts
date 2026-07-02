const UNDICI_HINTS: Record<string, string> = {
  UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
  UND_ERR_HEADERS_TIMEOUT: 'timed out waiting for response headers',
  UND_ERR_BODY_TIMEOUT: 'timed out reading response body',
  UND_ERR_HEADERS_OVERFLOW: 'response headers too large',
  UND_ERR_CLIENT_DISCONNECT: 'client disconnected',
  UND_ERR_SOCKET: 'socket terminated unexpectedly',
  UND_ERR_RES_CONTENT_LENGTH_MISMATCH:
    'response body length does not match Content-Length header',
  UND_ERR_REQ_CONTENT_LENGTH_MISMATCH:
    'request body length does not match Content-Length header',
  UND_ERR_ABORTED: 'request was aborted',
};

const NODE_HINTS: Record<string, string> = {
  ECONNRESET: 'connection reset by server',
  ECONNREFUSED: 'connection refused',
  ENOTFOUND: 'DNS lookup failed — host not found',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'broken pipe — server closed the connection',
};

function findCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'string') return e.code;
    if (e.cause !== undefined) return findCode(e.cause);
  }
  return undefined;
}

export function describeNetworkError(err: unknown): string {
  const code = findCode(err);
  if (code) {
    const hint = UNDICI_HINTS[code] ?? NODE_HINTS[code];
    if (hint) return `${hint} (${code})`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
