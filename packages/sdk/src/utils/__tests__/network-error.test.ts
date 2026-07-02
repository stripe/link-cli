import { describe, expect, it } from 'vitest';
import { describeNetworkError } from '../network-error';

function errWithCode(code: string, message = 'raw message'): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeNetworkError', () => {
  describe('undici error codes', () => {
    it.each([
      ['UND_ERR_CONNECT_TIMEOUT', 'connection timed out'],
      ['UND_ERR_HEADERS_TIMEOUT', 'timed out waiting for response headers'],
      ['UND_ERR_HEADERS_OVERFLOW', 'response headers exceeded maximum allowed size'],
      ['UND_ERR_BODY_TIMEOUT', 'timed out reading response body'],
      ['UND_ERR_INVALID_ARG', 'invalid argument passed to fetch'],
      ['UND_ERR_INVALID_RETURN_VALUE', 'invalid return value from fetch handler'],
      ['UND_ERR_ABORTED', 'request was aborted'],
      ['UND_ERR_ABORT', 'operation was aborted'],
      ['UND_ERR_DESTROYED', 'request failed — HTTP client was destroyed'],
      ['UND_ERR_CLOSED', 'request failed — HTTP client was closed'],
      ['UND_ERR_SOCKET', 'socket terminated unexpectedly'],
      ['UND_ERR_NOT_SUPPORTED', 'unsupported fetch functionality'],
      ['UND_ERR_REQ_CONTENT_LENGTH_MISMATCH', 'request body length does not match Content-Length header'],
      ['UND_ERR_RES_CONTENT_LENGTH_MISMATCH', 'response body length does not match Content-Length header'],
      ['UND_ERR_INFO', 'informational error from HTTP client'],
      ['UND_ERR_RES_EXCEEDED_MAX_SIZE', 'response body exceeded maximum allowed size'],
      ['UND_ERR_PRX_TLS', 'TLS connection to proxy failed'],
      ['UND_ERR_WS_MESSAGE_SIZE_EXCEEDED', 'WebSocket message exceeded maximum size'],
      ['UND_ERR_REQ_RETRY', 'request failed and could not be retried'],
      ['UND_ERR_RESPONSE', 'server returned an error status'],
      ['UND_ERR_MAX_ORIGINS_REACHED', 'maximum permitted origins reached'],
      ['UND_ERR_BPL_MISSING_UPSTREAM', 'no upstream configured in connection pool'],
      ['UND_ERR_SOCKS5', 'SOCKS5 proxy negotiation failed'],
    ])('%s → readable hint', (code, hint) => {
      expect(describeNetworkError(errWithCode(code))).toBe(`${hint} (${code})`);
    });
  });

  describe('Node.js errno codes', () => {
    it.each([
      ['ECONNRESET', 'connection reset by server'],
      ['ECONNREFUSED', 'connection refused'],
      ['ENOTFOUND', 'DNS lookup failed — host not found'],
      ['ETIMEDOUT', 'connection timed out'],
      ['EPIPE', 'broken pipe — server closed the connection'],
    ])('%s → readable hint', (code, hint) => {
      expect(describeNetworkError(errWithCode(code))).toBe(`${hint} (${code})`);
    });
  });

  it('walks nested cause chain to find the code', () => {
    // Real undici shape: TypeError('fetch failed') wrapping an undici SocketError
    const undiciError = errWithCode('UND_ERR_RES_CONTENT_LENGTH_MISMATCH');
    const fetchError = Object.assign(new TypeError('fetch failed'), {
      cause: undiciError,
    });
    expect(describeNetworkError(fetchError)).toBe(
      'response body length does not match Content-Length header (UND_ERR_RES_CONTENT_LENGTH_MISMATCH)',
    );
  });

  it('falls back to err.message for an unrecognized code', () => {
    expect(describeNetworkError(errWithCode('SOME_UNKNOWN_CODE', 'raw msg'))).toBe('raw msg');
  });

  it('falls back to err.message when there is no code', () => {
    expect(describeNetworkError(new Error('plain error'))).toBe('plain error');
  });

  it('falls back to String() for non-Error values', () => {
    expect(describeNetworkError('string error')).toBe('string error');
    expect(describeNetworkError(42)).toBe('42');
  });
});
