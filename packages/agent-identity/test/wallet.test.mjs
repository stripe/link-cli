import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  constants,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
} from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { clearJwksCache, LinkVerifier } from '@stripe/agent-identity';
import { CredentialFixture } from '@stripe/agent-identity/testing';
import { wrapRsaSsaPssSpki } from '../dist/esm/internal/der.js';
import { startServer } from '../example/step-up/server.mjs';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../cli/dist/cli.js', import.meta.url));
const agent = fileURLToPath(
  new URL('../example/step-up/agent.mjs', import.meta.url),
);
const preload = fileURLToPath(
  new URL('fixtures/wallet-isolation.mjs', import.meta.url),
);
const issuer = 'https://api.link.com';
const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });

// This test runs separately from SDK-only tests: it needs the built wallet too.
test('built wallet issues credentials that the verifier and HTTP example accept', {
  timeout: 120_000,
}, async (t) => {
  clearJwksCache();
  const root = await mkdtemp(join(tmpdir(), 'link-identity-wallet-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const spki = Buffer.from(
    wrapRsaSsaPssSpki(publicKey.export({ format: 'der', type: 'pkcs1' })),
  );
  const tokenKeyId = createHash('sha256').update(spki).digest('base64url');
  const metadata = {
    issuer,
    token_issuance_endpoint: `${issuer}/identity/attestations`,
    credential_endpoint: `${issuer}/identity/credentials`,
    token_keys: `${issuer}/.well-known/aap-issuer/token-keys`,
    claims_jwks_uri: `${issuer}/.well-known/aap-issuer/jwks.json`,
    claims_supported: ['email', 'email_verified', 'given_name'],
  };
  const hits = [];
  const issuerErrors = [];
  let credential;
  let requestedHolder;
  async function issuerFetch(input, init = {}) {
    const url = String(input);
    const method = init.method ?? 'GET';
    hits.push({ url, method });
    if (method === 'GET') {
      if (url === `${issuer}/.well-known/aap-issuer`)
        return Response.json(metadata);
      if (url === metadata.token_keys)
        return Response.json({
          'token-keys': [
            { 'token-type': 2, 'token-key': spki.toString('base64url') },
          ],
        });
      if (url === metadata.claims_jwks_uri && credential)
        return credential.fetchImpl()(input, init);
      assert.fail(`Unexpected issuer GET: ${url}`);
    }
    assert.equal(method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(headers.get('Authorization'), 'Bearer synthetic-link-token');
    const body = JSON.parse(init.body);
    if (url === metadata.token_issuance_endpoint) {
      assert.deepEqual(Object.keys(body).sort(), ['messages', 'token_key_id']);
      assert.equal(body.token_key_id, tokenKeyId);
      assert.equal(body.messages.length, 3);
      // Sign the actual blinded representatives. The wallet must unblind them.
      const attestations = body.messages.map((message) => {
        const bytes = Buffer.from(message, 'base64url');
        assert.equal(bytes.length, 256);
        assert.equal(bytes.toString('base64url'), message);
        return privateDecrypt(
          { key: privateKey, padding: constants.RSA_NO_PADDING },
          bytes,
        ).toString('base64url');
      });
      return Response.json({ attestations });
    }
    assert.equal(url, metadata.credential_endpoint);
    assert.deepEqual(Object.keys(body), ['cnf']);
    assert.deepEqual(Object.keys(body.cnf), ['jwk']);
    assert.deepEqual(Object.keys(body.cnf.jwk).sort(), ['crv', 'kty', 'x']);
    requestedHolder = body.cnf.jwk;
    credential = await CredentialFixture.create({
      issuerUrl: issuer,
      claims: {
        email: 'synthetic@example.com',
        email_verified: true,
        given_name: 'Undisclosed',
      },
      extraPayload: { cnf: body.cnf },
    });
    const payload = JSON.parse(
      Buffer.from(credential.issuerJwt.split('.')[1], 'base64url'),
    );
    return Response.json({
      credential: `${[credential.issuerJwt, ...credential.disclosures].join('~')}~`,
      issuer,
      expires_at: new Date(payload.exp * 1000).toISOString(),
    });
  }
  const broker = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const { url, init } = JSON.parse(raw);
      const result = await issuerFetch(url, init);
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(await result.text());
    } catch (error) {
      issuerErrors.push(error);
      res.writeHead(500);
      res.end('Fixture contract failed');
    }
  });
  t.after(() => close(broker));
  await new Promise((resolve, reject) => {
    broker.once('error', reject);
    broker.listen(0, '127.0.0.1', resolve);
  });
  // No inherited auth, proxy, NODE_OPTIONS, or agent configuration.
  const wallet = join(root, 'wallet');
  const env = {
    PATH: process.env.PATH,
    LINK_TEST_NODE: process.execPath,
    LINK_TEST_CLI: cli,
    LINK_TEST_PRELOAD: preload,
    LINK_TEST_WALLET_HOME: root,
    LINK_TEST_BROKER: `http://127.0.0.1:${broker.address().port}`,
    LINK_ACCESS_TOKEN: 'synthetic-link-token',
    LINK_AUTH_FILE: join(root, 'auth.json'),
    LINK_IDENTITY_COMMANDS: '1',
    NO_UPDATE_NOTIFIER: '1',
    LINK_WALLET_BIN: wallet,
  };
  // Fixed shell text; paths and wallet arguments are always quoted.
  await writeFile(
    wallet,
    '#!/bin/sh\nexec "$LINK_TEST_NODE" --import "$LINK_TEST_PRELOAD" "$LINK_TEST_CLI" "$@"\n',
    { mode: 0o700 },
  );
  const invoke = async (args) => {
    const { stdout } = await run(
      process.execPath,
      ['--import', preload, cli, 'identity', ...args, '--format', 'json'],
      { env, timeout: 20_000, signal: t.signal },
    );
    assert.deepEqual(issuerErrors, []);
    return JSON.parse(stdout);
  };
  const identity = join(root, '.link-cli', 'identity');
  const poolPath = join(identity, 'attestations', 'pool.json');
  const credentialPath = join(identity, 'credentials', 'current.json');
  const holderPath = join(identity, 'holder-key.jwk');
  const verifier = new LinkVerifier({
    origin: 'https://events.example',
    fetchImpl: issuerFetch,
  });
  let issued;
  let popped;
  let savedCredential;
  let savedHolder;
  let pooledTokens;

  await t.test(
    'JSON issuance saves three tokens and returns metadata only',
    async () => {
      const requested = await invoke([
        'attestations',
        'request',
        '--count',
        '3',
      ]);
      assert.equal(requested.output_file, poolPath);
      assert.equal((await stat(poolPath)).mode & 0o777, 0o600);
      const pool = JSON.parse(await readFile(poolPath, 'utf8'));
      assert.equal(pool.version, 2);
      assert.equal(pool.batches[0].tokens.length, 3);
      pooledTokens = pool.batches[0].tokens.map(({ token }) => token);
      for (const token of pooledTokens)
        assert(!JSON.stringify(requested).includes(token));
      assert.equal(
        (await invoke(['attestations', 'list'])).total_token_count,
        3,
      );
    },
  );
  await t.test(
    'credential issuance binds the saved credential to the local holder key',
    async () => {
      issued = await invoke(['credentials', 'request']);
      assert.equal(issued.output_file, credentialPath);
      assert.equal(issued.holder.path, holderPath);
      savedCredential = await readFile(credentialPath, 'utf8');
      savedHolder = await readFile(holderPath, 'utf8');
      const { crv, kty, x, d } = JSON.parse(savedHolder).private_jwk;
      assert.deepEqual(requestedHolder, { crv, kty, x });
      assert.equal(typeof d, 'string');
      for (const secret of [
        d,
        credential.issuerJwt,
        'synthetic@example.com',
        'Undisclosed',
      ])
        assert(!JSON.stringify(issued).includes(secret));
      for (const path of [credentialPath, holderPath])
        assert.equal((await stat(path)).mode & 0o777, 0o600);
    },
  );
  await t.test(
    'pop removes a token that verifies, and a modified signature is rejected',
    async () => {
      const before = hits.length;
      popped = await invoke(['attestations', 'pop']);
      assert.equal(hits.length, before);
      const result = await verifier.verifyAttestation(popped.authorization);
      assert.equal(result.valid, true);
      assert.equal(result.tokenKeyId, tokenKeyId);
      const corrupt = Buffer.from(popped.token, 'base64url');
      corrupt[corrupt.length - 1] ^= 1;
      assert.equal(
        (
          await verifier.verifyAttestation(
            `PrivateToken token="${corrupt.toString('base64url')}"`,
          )
        ).valid,
        false,
      );
      assert.equal(
        (await invoke(['attestations', 'list'])).total_token_count,
        2,
      );
    },
  );
  await t.test(
    'presentation discloses selected claims and verifies only for its audience and nonce',
    async () => {
      const before = hits.length;
      const { presentation } = await invoke([
        'credentials',
        'present',
        '--aud',
        'https://events.example',
        '--nonce',
        'registration-nonce',
        '--claim',
        'email',
        '--claim',
        'email_verified',
      ]);
      assert.equal(hits.length, before);
      const options = {
        nonce: 'registration-nonce',
        requiredClaims: ['email', 'email_verified'],
      };
      const result = await verifier.verifyClaims(presentation, options);
      assert.equal(result.valid, true);
      assert.deepEqual(result.claims, {
        email: 'synthetic@example.com',
        email_verified: true,
      });
      assert.equal(result.holderKeyThumbprint, issued.holder.thumbprint);
      assert.equal(
        (
          await verifier.verifyClaims(presentation, {
            ...options,
            nonce: 'wrong-nonce',
          })
        ).valid,
        false,
      );
      const other = new LinkVerifier({
        origin: 'https://other.example',
        fetchImpl: issuerFetch,
      });
      assert.equal(
        (await other.verifyClaims(presentation, options)).valid,
        false,
      );
      assert.equal(await readFile(credentialPath, 'utf8'), savedCredential);
      assert.equal(await readFile(holderPath, 'utf8'), savedHolder);
    },
  );
  await t.test(
    'executable example completes access, email step-up, and idempotent retry',
    async () => {
      const app = await startServer({ fetchImpl: issuerFetch });
      t.after(() => close(app.server));
      const { stdout } = await run(
        process.execPath,
        [agent, app.origin, '--share-email'],
        { env, timeout: 30_000, signal: t.signal },
      );
      assert.deepEqual(
        stdout
          .trim()
          .split('\n')
          .map((line) => Number(line.split(':')[0])),
        [401, 200, 401, 201, 200, 200],
      );
      for (const secret of [
        'synthetic@example.com',
        ...pooledTokens,
        credential.issuerJwt,
      ])
        assert(!stdout.includes(secret));
      assert.equal(
        (await invoke(['attestations', 'list'])).total_token_count,
        1,
      );
      assert.deepEqual(
        hits.filter(({ method }) => method === 'POST').map(({ url }) => url),
        [metadata.token_issuance_endpoint, metadata.credential_endpoint],
      );
      assert.deepEqual(issuerErrors, []);
    },
  );
});
