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
      ['UND_ERR_BODY_TIMEOUT', 'timed out reading response body'],
      ['UND_ERR_HEADERS_OVERFLOW', 'response headers too large'],
      ['UND_ERR_CLIENT_DISCONNECT', 'client disconnected'],
      ['UND_ERR_SOCKET', 'socket terminated unexpectedly'],
      [
        'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
        'response body length does not match Content-Length header',
      ],
      [
        'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
        'request body length does not match Content-Length header',
      ],
      ['UND_ERR_ABORTED', 'request was aborted'],
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
