import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { clearJwksCache } from '@stripe/agent-identity';
import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '@stripe/agent-identity/testing';
import { registerForEvent } from './agent.mjs';
import { startServer } from './server.mjs';

const link = await LinkFixture.create();
const close = (server) =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

async function setup(
  t,
  { claims, credentialOptions, serverOptions, wrapFetch } = {},
) {
  clearJwksCache();
  const credential = await CredentialFixture.create({
    issuerUrl: link.issuer,
    claims: claims ?? {
      email: 'alex@example.com',
      email_verified: true,
      given_name: 'Alex',
    },
    ...credentialOptions,
  });
  const fetchImpl = combineFetch(credential.fetchImpl(), link.fetchImpl());
  const app = await startServer({
    fetchImpl: wrapFetch ? wrapFetch(fetchImpl) : fetchImpl,
    ...serverOptions,
  });
  t.after(() => close(app.server));
  async function call(
    path,
    { session, interaction, presentation, body, ...init } = {},
  ) {
    const response = await fetch(`${app.url}${path}`, {
      ...init,
      headers: {
        ...(session ? { Authorization: `Bearer ${session}` } : {}),
        ...(interaction ? { 'X-Registration-Interaction': interaction } : {}),
        ...(presentation ? { 'Identity-Presentation': presentation } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(body !== undefined
        ? { method: 'POST', body: JSON.stringify(body) }
        : {}),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }
  const enter = async () => {
    const result = await call('/events', {
      headers: { Authorization: (await link.mint()).authorization },
    });
    assert.equal(result.status, 200);
    return result.body.session_token;
  };
  const challenge = async (session, event = 'autumn-meetup') => {
    const result = await call('/registrations', {
      session,
      body: { event_id: event },
    });
    assert.equal(result.status, 401);
    assert.equal(
      result.headers.get('www-authenticate'),
      'Identity-Presentation',
    );
    return result.body;
  };
  const present = (value, overrides = {}) =>
    credential.present({
      aud: app.origin,
      nonce: value.nonce,
      disclose: ['email', 'email_verified'],
      ...overrides,
    });
  const submit = (session, value, presentation, event = 'autumn-meetup') =>
    call('/registrations', {
      session,
      interaction: value.interaction_id,
      presentation,
      body: { event_id: event },
    });
  return { ...app, credential, call, enter, challenge, present, submit };
}

test('complete HTTP agent flow: attestation, email step-up, idempotent retry, and session read', async (t) => {
  const app = await setup(t);
  const statuses = [];
  const registration = await registerForEvent({
    origin: app.origin,
    getAttestation: async () => (await link.mint()).authorization,
    createPresentation: (challenge) => {
      assert.deepEqual(challenge.claims, ['email', 'email_verified']);
      return app.present(challenge);
    },
    onStep: (_, status) => statuses.push(status),
  });
  assert.deepEqual(statuses, [401, 200, 401, 201, 200, 200]);
  assert.equal(registration.email, 'alex@example.com');
  assert.equal(registration.event_id, 'autumn-meetup');
  assert.equal(registration.given_name, undefined);
});

test('missing and forged AATs cannot create a session; registration requires a site session', async (t) => {
  const app = await setup(t);
  for (const authorization of [
    undefined,
    (await link.mint({ corruptAuthenticator: true })).authorization,
  ]) {
    const result = await app.call('/events', {
      headers: authorization ? { Authorization: authorization } : {},
    });
    assert.equal(result.status, 401);
    assert.match(result.headers.get('www-authenticate'), /^PrivateToken /);
    assert.equal(result.body.session_token, undefined);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  const result = await app.call('/registrations', {
    body: { event_id: 'autumn-meetup' },
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'session_required');
});

test('attestation issuer outages return 503 without a misleading credential challenge', async (t) => {
  const app = await setup(t, {
    serverOptions: { fetchImpl: async () => new Response('', { status: 503 }) },
  });
  const result = await app.call('/events');
  assert.equal(result.status, 503);
  assert.equal(result.headers.get('www-authenticate'), null);
  assert.equal(result.body.session_token, undefined);
});

test('wrong audience, wrong nonce, and missing claims can be corrected without completing the interaction', async (t) => {
  const app = await setup(t);
  const session = await app.enter();
  const challenge = await app.challenge(session);
  for (const options of [
    { aud: 'https://elsewhere.example' },
    { nonce: 'wrong-nonce' },
    { disclose: ['email'] },
  ]) {
    assert.equal(
      (
        await app.submit(
          session,
          challenge,
          await app.present(challenge, options),
        )
      ).status,
      401,
    );
  }
  assert.equal(
    (await app.submit(session, challenge, await app.present(challenge))).status,
    201,
  );
});

test('an expired credential cannot authorize registration', async (t) => {
  const app = await setup(t, { credentialOptions: { expiresInSeconds: -1 } });
  const session = await app.enter();
  const challenge = await app.challenge(session);
  assert.equal(
    (await app.submit(session, challenge, await app.present(challenge))).status,
    401,
  );
});

test('application policy rejects false or incorrectly typed verification flags and invalid email values', async (t) => {
  for (const claims of [
    { email: 'alex@example.com', email_verified: false },
    { email: 'alex@example.com', email_verified: 'true' },
    { email: 42, email_verified: true },
  ]) {
    const app = await setup(t, { claims });
    const session = await app.enter();
    const challenge = await app.challenge(session);
    const result = await app.submit(
      session,
      challenge,
      await app.present(challenge),
    );
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'verified_email_required');
  }
});

test('interaction and receipt are scoped to the bearer session and the original event', async (t) => {
  const app = await setup(t);
  const first = await app.enter();
  const second = await app.enter();
  const challenge = await app.challenge(first);
  const presentation = await app.present(challenge);
  assert.equal((await app.submit(second, challenge, presentation)).status, 403);
  assert.equal(
    (await app.submit(first, challenge, presentation, 'winter-meetup')).status,
    409,
  );
  const result = await app.submit(first, challenge, presentation);
  assert.equal(result.status, 201);
  assert.equal(
    (await app.call(`/registrations/${result.body.id}`, { session: first }))
      .status,
    200,
  );
  assert.equal(
    (await app.call(`/registrations/${result.body.id}`, { session: second }))
      .status,
    404,
  );
  assert.equal((await app.submit(second, challenge, presentation)).status, 403);
});

test('concurrent valid retries commit one registration and return its saved result', async (t) => {
  const app = await setup(t);
  const session = await app.enter();
  const challenge = await app.challenge(session);
  const presentation = await app.present(challenge);
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      app.submit(session, challenge, presentation),
    ),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 11);
  assert.equal(new Set(results.map((result) => result.body.id)).size, 1);
  const retry = await app.submit(session, challenge);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, results[0].body.id);
});

test('application challenge expiry rejects an otherwise fresh presentation', async (t) => {
  let time = Math.floor(Date.now() / 1000);
  const app = await setup(t, { serverOptions: { now: () => time } });
  const session = await app.enter();
  const challenge = await app.challenge(session);
  time += 300;
  const result = await app.submit(
    session,
    challenge,
    await app.present(challenge, { iat: time }),
  );
  assert.equal(result.status, 410);
});

test('expiry is rechecked after asynchronous verification', async (t) => {
  let time = Math.floor(Date.now() / 1000);
  const app = await setup(t, {
    serverOptions: { now: () => time },
    wrapFetch: (original) => async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith('/jwks.json')) time += 2;
      return response;
    },
  });
  const session = await app.enter();
  const challenge = await app.challenge(session);
  time += 299;
  const result = await app.submit(
    session,
    challenge,
    await app.present(challenge, { iat: time }),
  );
  assert.equal(result.status, 410);
  assert.equal(result.body.code, 'interaction_expired');
});

test('application session expiry prevents receipt access even after successful registration', async (t) => {
  let time = Math.floor(Date.now() / 1000);
  const app = await setup(t, { serverOptions: { now: () => time } });
  const session = await app.enter();
  const challenge = await app.challenge(session);
  const registration = await app.submit(
    session,
    challenge,
    await app.present(challenge),
  );
  time += 600;
  assert.equal(
    (await app.call(`/registrations/${registration.body.id}`, { session }))
      .status,
    401,
  );
});

test('session expiry while reading a retry body prevents returning the saved registration', async (t) => {
  let time = Math.floor(Date.now() / 1000);
  const app = await setup(t, { serverOptions: { now: () => time } });
  const session = await app.enter();
  const challenge = await app.challenge(session);
  await app.submit(session, challenge, await app.present(challenge));
  app.server.once('request', (req) =>
    req.once('data', () => {
      time += 600;
    }),
  );
  const result = await app.submit(session, challenge);
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'session_expired');
});

test('bounded application state refuses new sessions and interactions at capacity', async (t) => {
  const app = await setup(t, {
    serverOptions: { maxSessions: 1, maxInteractions: 1 },
  });
  const session = await app.enter();
  assert.equal(
    (
      await app.call('/events', {
        headers: { Authorization: (await link.mint()).authorization },
      })
    ).status,
    503,
  );
  await app.challenge(session);
  assert.equal(
    (
      await app.call('/registrations', {
        session,
        body: { event_id: 'autumn-meetup' },
      })
    ).status,
    429,
  );
});

test('request validation rejects extra claims, malformed JSON, wrong content types, and oversized bodies', async (t) => {
  const app = await setup(t);
  const session = await app.enter();
  assert.equal(
    (
      await app.call('/registrations', {
        session,
        body: { event_id: 'autumn-meetup', email: 'untrusted@example.com' },
      })
    ).status,
    400,
  );
  for (const [body, contentType, expected] of [
    ['{', 'application/json', 400],
    ['null', 'application/json', 400],
    ['[]', 'application/json', 400],
    ['{}', 'text/plain', 415],
    [' '.repeat(8193), 'application/json', 413],
  ]) {
    const response = await fetch(`${app.url}/registrations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session}`,
        'Content-Type': contentType,
      },
      body,
    });
    assert.equal(response.status, expected);
    await response.arrayBuffer();
  }
});

test('duplicate credential and interaction headers are rejected at the HTTP boundary', async (t) => {
  const app = await setup(t);
  for (const name of [
    'Authorization',
    'Identity-Presentation',
    'X-Registration-Interaction',
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(
        `${app.url}/events`,
        { headers: [name, 'first', name, 'second'] },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 400);
  }
});

test('agent rejects an unexpected audience before asking the wallet to disclose claims', async (t) => {
  const app = await setup(t);
  let disclosed = false;
  await assert.rejects(
    registerForEvent({
      origin: app.origin,
      getAttestation: async () => (await link.mint()).authorization,
      createPresentation: async () => {
        disclosed = true;
        return '';
      },
      fetchImpl: async (url, init) => {
        const response = await fetch(url, init);
        if (String(url).endsWith('/registrations') && response.status === 401) {
          return Response.json(
            { ...(await response.json()), aud: 'https://wrong.example' },
            {
              status: 401,
              headers: response.headers,
            },
          );
        }
        return response;
      },
    }),
    /Unexpected identity challenge/,
  );
  assert.equal(disclosed, false);
});

test('agent rejects malformed or expired challenges before disclosing claims', async (t) => {
  const app = await setup(t);
  const changes = [
    { type: 'unexpected-problem' },
    { event_id: 'winter-meetup' },
    { nonce: '' },
    { nonce: ' '.repeat(43) },
    { nonce: 42 },
    { interaction_id: 'unsafe\r\nheader' },
    { interaction_id: null },
    { expires_at: undefined },
    { expires_at: 1 },
    { expires_at: Math.floor(Date.now() / 1000) },
    { expires_at: '9999999999' },
    { expires_at: 9999999999.5 },
    { claims: ['email', 'given_name'] },
    { claims: ['email', 'email_verified', 'given_name'] },
    { formats: 'not-dc+sd-jwt-supported' },
    { formats: ['dc+sd-jwt', 42] },
    { trusted_issuers: 'https://api.link.com.attacker.example' },
    { trusted_issuers: ['https://api.link.com', null] },
    null,
  ];
  for (const change of changes) {
    let disclosed = false;
    await assert.rejects(
      registerForEvent({
        origin: app.origin,
        getAttestation: async () => (await link.mint()).authorization,
        createPresentation: async () => {
          disclosed = true;
          return '';
        },
        fetchImpl: async (url, init) => {
          const response = await fetch(url, init);
          if (
            String(url).endsWith('/registrations') &&
            response.status === 401
          ) {
            const challenge = await response.json();
            return Response.json(
              change === null ? null : { ...challenge, ...change },
              { status: 401, headers: response.headers },
            );
          }
          return response;
        },
      }),
      /Unexpected identity challenge/,
    );
    assert.equal(disclosed, false);
  }
});

test('agent does not submit a presentation when its challenge expires during wallet work', async (t) => {
  const app = await setup(t);
  let submissions = 0;
  await assert.rejects(
    registerForEvent({
      origin: app.origin,
      getAttestation: async () => (await link.mint()).authorization,
      createPresentation: async (challenge) => {
        const presentation = await app.present(challenge);
        t.mock.method(Date, 'now', () => challenge.expires_at * 1000);
        return presentation;
      },
      fetchImpl: async (url, init) => {
        if (init.headers?.['Identity-Presentation']) submissions++;
        return fetch(url, init);
      },
    }),
    /Identity challenge expired before submission/,
  );
  assert.equal(submissions, 0);
});

test('agent never follows a redirect on a credential-bearing request', async (t) => {
  let leaked = 0;
  const trap = createServer((_req, res) => {
    leaked++;
    res.end();
  });
  await new Promise((resolve) => trap.listen(0, '127.0.0.1', resolve));
  t.after(() => close(trap));
  const redirector = createServer((req, res) => {
    if (!req.headers.authorization)
      res.writeHead(401, {
        'WWW-Authenticate': 'PrivateToken challenge="fixture"',
      });
    else
      res.writeHead(302, {
        Location: `http://127.0.0.1:${trap.address().port}/stolen`,
      });
    res.end();
  });
  await new Promise((resolve) => redirector.listen(0, '127.0.0.1', resolve));
  t.after(() => close(redirector));
  await assert.rejects(
    registerForEvent({
      origin: `http://127.0.0.1:${redirector.address().port}`,
      getAttestation: async () => (await link.mint()).authorization,
      createPresentation: async () => {
        throw new Error('must not disclose');
      },
    }),
  );
  assert.equal(leaked, 0);
});

test('executable client invokes the wallet programmatically and keeps proofs and email out of output', async (t) => {
  const app = await setup(t);
  const calls = [];
  const authorization = (await link.mint()).authorization;
  let presentation;
  // A test-only wallet executable forwards its argv to this local fixture.
  const wallet = createServer((req, res) => {
    (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const args = JSON.parse(Buffer.concat(chunks));
      calls.push(args);
      if (args[1] === 'attestations') {
        res.end(JSON.stringify({ authorization }));
      } else {
        presentation = await app.credential.present({
          aud: args[args.indexOf('--aud') + 1],
          nonce: args[args.indexOf('--nonce') + 1],
          disclose: args.flatMap((arg, i) =>
            arg === '--claim' ? [args[i + 1]] : [],
          ),
        });
        res.end(JSON.stringify({ presentation }));
      }
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve) => wallet.listen(0, '127.0.0.1', resolve));
  t.after(() => close(wallet));
  const directory = await mkdtemp(join(tmpdir(), 'step-up wallet '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'wallet.mjs');
  await writeFile(
    executable,
    `#!/usr/bin/env node
const response = await fetch('http://127.0.0.1:${wallet.address().port}', {
  method: 'POST', body: JSON.stringify(process.argv.slice(2)),
});
if (!response.ok) process.exit(1);
process.stdout.write(await response.text());
`,
    { mode: 0o700 },
  );
  const agentFile = fileURLToPath(new URL('./agent.mjs', import.meta.url));
  const run = (args) =>
    promisify(execFile)(process.execPath, [agentFile, app.origin, ...args], {
      env: { ...process.env, LINK_WALLET_BIN: executable },
      timeout: 20_000,
    });
  await assert.rejects(
    run([]),
    (error) => error.code === 1 && error.stderr.includes('--share-email'),
  );
  assert.equal(calls.length, 0);
  const { stdout, stderr } = await run(['--share-email']);
  assert.equal(stderr, '');
  assert.deepEqual(
    stdout
      .trim()
      .split('\n')
      .map((line) => Number(line.slice(0, 3))),
    [401, 200, 401, 201, 200, 200],
  );
  assert.deepEqual(calls[0], [
    'identity',
    'attestations',
    'pop',
    '--format',
    'json',
  ]);
  assert.deepEqual(calls[1], [
    'identity',
    'credentials',
    'present',
    '--aud',
    app.origin,
    '--nonce',
    calls[1][6],
    '--claim',
    'email',
    '--claim',
    'email_verified',
    '--format',
    'json',
  ]);
  assert.equal(calls.length, 2);
  for (const sensitive of [authorization, presentation, 'alex@example.com'])
    assert.ok(!stdout.includes(sensitive));

  await writeFile(
    executable,
    '#!/usr/bin/env node\nconsole.error("sensitive wallet error"); process.exit(1);\n',
  );
  await assert.rejects(run(['--share-email']), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Wallet command failed/);
    assert.ok(!error.stderr.includes('sensitive wallet error'));
    return true;
  });
});

test('executable client redacts platform errors while preserving locally authored status errors', async (t) => {
  const sensitive = 'fixture-private@example.com';
  let mode = 'response';
  let origin;
  const service = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(401, {
        'WWW-Authenticate': 'PrivateToken challenge="fixture"',
      });
      res.end();
    } else if (req.url === '/events') {
      res.end(JSON.stringify({ session_token: 's'.repeat(43) }));
    } else if (!req.headers['identity-presentation']) {
      res.writeHead(401, { 'WWW-Authenticate': 'Identity-Presentation' });
      res.end(
        JSON.stringify({
          type: 'urn:stripe:link:claims-required',
          aud: origin,
          event_id: 'autumn-meetup',
          nonce: 'n'.repeat(43),
          interaction_id: 'i'.repeat(43),
          expires_at: Math.floor(Date.now() / 1000) + 300,
          claims: ['email', 'email_verified'],
          formats: ['dc+sd-jwt'],
          trusted_issuers: ['https://api.link.com'],
        }),
      );
    } else {
      res.writeHead(mode === 'status' ? 503 : 201);
      res.end(sensitive);
    }
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${service.address().port}`;
  t.after(() => close(service));
  const directory = await mkdtemp(join(tmpdir(), 'step-up redaction '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'wallet.mjs');
  const agentFile = fileURLToPath(new URL('./agent.mjs', import.meta.url));
  for (mode of ['response', 'header', 'status']) {
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconsole.log(${JSON.stringify(
        JSON.stringify({
          authorization: 'PrivateToken token=fixture',
          presentation: mode === 'header' ? `${sensitive}\ninvalid` : 'fixture',
        }),
      )});\n`,
      { mode: 0o700 },
    );
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [agentFile, origin, '--share-email'],
        {
          env: { ...process.env, LINK_WALLET_BIN: executable },
          timeout: 20_000,
        },
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.ok(!`${error.stdout}${error.stderr}`.includes(sensitive));
        assert.match(
          error.stderr,
          mode === 'status'
            ? /expected HTTP 201, received 503/
            : /Registration failed\. Check the service response/,
        );
        return true;
      },
    );
  }
});
