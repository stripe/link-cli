import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parsePrivateTokenCredential } from '@/attestation';
import { fromBase64 } from '@/internal/bytes';
import { LinkIssuer } from '@/issuer';

describe('issuer fetches are bounded and same-origin', () => {
  it('refuses metadata naming an off-origin token_keys', async () => {
    // The verifier requires every key URL to be same-origin with the issuer. An
    // open redirect, or a metadata document naming somewhere else, substitutes the
    // trust anchor the whole verifier reduces to.
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === 'https://api.link.com/.well-known/aap-issuer') {
        return new Response(
          JSON.stringify({
            issuer: 'https://api.link.com',
            token_issuance_endpoint:
              'https://api.link.com/identity/attestations',
            token_keys: 'https://attacker.example/token-keys',
          }),
          { status: 200 },
        );
      }
      return new Response('{"token-keys":[]}', { status: 200 });
    }) as typeof fetch;

    const issuer = new LinkIssuer({ fetchImpl, minRefreshSeconds: 0 });
    await assert.rejects(() => issuer.refresh({ force: true }), /same-origin/);
  });

  it('gives up on an issuer directory that never answers', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    const issuer = new LinkIssuer({
      fetchImpl,
      minRefreshSeconds: 0,
      timeoutMs: 50,
    });
    await assert.rejects(() => issuer.refresh({ force: true }), /timed out/);
  });
});

describe('PrivateToken auth-params', () => {
  it('ignores unknown quoted parameters containing commas', () => {
    const parsed = parsePrivateTokenCredential(
      'PrivateToken extra="a,b", token="AQID"',
    );
    assert.deepEqual(parsed, new Uint8Array([1, 2, 3]));
  });

  it('rejects a second credential instead of ignoring it as an unknown parameter', () => {
    const parsed = parsePrivateTokenCredential(
      'PrivateToken token="AQID", PrivateToken token="BAUG"',
    );
    assert.match(parsed as string, /malformed auth parameters/);
  });

  it('rejects an unterminated quoted parameter', () => {
    const parsed = parsePrivateTokenCredential(
      'PrivateToken token="AQID", extra="unfinished',
    );
    assert.match(parsed as string, /unterminated quoted parameter/);
  });

  it('does not read a value out of a differently named parameter', async () => {
    // `foo-token` contains `token`, so substring matching extracted BBB.
    const result = parsePrivateTokenCredential(
      'PrivateToken foo-token=BBBB, token=AAAA',
    );
    assert.deepEqual(result, fromBase64('AAAA'));
  });

  it('ignores unknown parameters, per RFC 9577', () => {
    const result = parsePrivateTokenCredential(
      'PrivateToken other="x", token="AAAA"',
    );
    assert.deepEqual(result, fromBase64('AAAA'));
  });

  it('refuses two token parameters rather than choosing', () => {
    const result = parsePrivateTokenCredential(
      'PrivateToken token=AAAA, token=BBBB',
    );
    assert.equal(typeof result, 'string');
    assert.match(result as string, /more than one token/);
  });
});
