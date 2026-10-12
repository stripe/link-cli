import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { isRejection, LinkVerifier } from '@stripe/agent-identity';

const EVENTS = [
  { id: 'autumn-meetup', title: 'Autumn meetup' },
  { id: 'winter-meetup', title: 'Winter meetup' },
];
const REQUIRED_CLAIMS = ['email', 'email_verified'];
const opaqueToken = () => randomBytes(32).toString('base64url');

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function registrationBody(req) {
  if (
    req.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    throw { status: 415, code: 'json_required' };
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8192) {
      req.resume();
      throw { status: 413, code: 'body_too_large' };
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw { status: 400, code: 'invalid_json' };
  }
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    !EVENTS.some((event) => event.id === body.event_id)
  ) {
    throw { status: 400, code: 'invalid_event' };
  }
  return body;
}

/** Application state for a single-process example. No SDK replay/session store. */
function createHandler(
  verifier,
  { now, sessionTtlSeconds, maxSessions, maxInteractions },
) {
  const sessions = new Map();

  return async (req, res) => {
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now()) sessions.delete(token);
    }
    for (const name of [
      'authorization',
      'identity-presentation',
      'x-registration-interaction',
    ]) {
      if ((req.headersDistinct[name]?.length ?? 0) > 1) {
        return json(res, 400, { code: 'duplicate_credential_field' });
      }
    }

    const pathname = new URL(req.url, 'http://localhost').pathname;
    const authorization = req.headers.authorization;
    const sessionToken = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : undefined;
    const session = sessions.get(sessionToken);

    if (req.method === 'GET' && pathname === '/events') {
      if (session) return json(res, 200, { events: EVENTS });
      const result = await verifier.verifyAttestation(authorization);
      if (!result.valid) {
        const failure = result.failures[0];
        if (!isRejection(failure))
          return json(res, 503, { code: failure.code });
        const challenge = await verifier.attestationChallenge();
        return json(
          res,
          401,
          { code: failure.code, message: failure.message },
          {
            'WWW-Authenticate': challenge.wwwAuthenticate,
          },
        );
      }
      // Verification awaited crypto/network work, so check capacity afterward.
      if (sessions.size >= maxSessions)
        return json(res, 503, { code: 'session_capacity' });
      const token = opaqueToken();
      const expiresAt = now() + sessionTtlSeconds;
      sessions.set(token, { expiresAt, interactions: new Map() });
      // This grants access to browse and request registration, not a user identity.
      return json(res, 200, {
        events: EVENTS,
        session_token: token,
        expires_at: expiresAt,
      });
    }

    if (
      !(req.method === 'POST' && pathname === '/registrations') &&
      !(req.method === 'GET' && pathname.startsWith('/registrations/'))
    ) {
      return json(res, 404, { code: 'not_found' });
    }
    if (!session) {
      return json(
        res,
        401,
        {
          code: 'session_required',
          message: 'Obtain a site session from /events.',
        },
        {
          'WWW-Authenticate': 'Bearer realm="event-registration"',
        },
      );
    }
    if (req.method === 'GET') {
      const id = pathname.slice('/registrations/'.length);
      const record = [...session.interactions.values()].find(
        (item) => item.registration?.id === id,
      );
      return record
        ? json(res, 200, record.registration)
        : json(res, 404, { code: 'not_found' });
    }

    const { event_id: eventId } = await registrationBody(req);
    if (session.expiresAt <= now())
      return json(res, 401, { code: 'session_expired' });
    const interactionId = req.headers['x-registration-interaction'];
    const presentation = req.headers['identity-presentation'];
    if (!interactionId) {
      if (presentation) return json(res, 400, { code: 'interaction_required' });
      const challenge = await verifier.claimsChallenge({
        claims: REQUIRED_CLAIMS,
        purpose: `Register for ${EVENTS.find((event) => event.id === eventId).title}`,
        nonceTtlSeconds: 300,
      });
      // Expire pending interactions; retain completed results for retries.
      for (const [id, record] of session.interactions) {
        if (!record.registration && record.challenge.expiresAt <= now())
          session.interactions.delete(id);
      }
      if (session.expiresAt <= now())
        return json(res, 401, { code: 'session_expired' });
      if (session.interactions.size >= maxInteractions)
        return json(res, 429, { code: 'interaction_capacity' });
      const id = opaqueToken();
      session.interactions.set(id, { eventId, challenge });
      return json(
        res,
        401,
        {
          ...challenge.body,
          interaction_id: id,
          expires_at: challenge.expiresAt,
          event_id: eventId,
        },
        {
          'WWW-Authenticate': challenge.wwwAuthenticate,
          'Content-Type': 'application/problem+json',
        },
      );
    }

    const record = session.interactions.get(interactionId);
    if (!record) return json(res, 403, { code: 'unknown_interaction' });
    if (record.eventId !== eventId)
      return json(res, 409, { code: 'operation_mismatch' });
    // The bearer session plus the same interaction/operation authorizes retries.
    // Return the saved result without performing the registration again.
    if (record.registration) return json(res, 200, record.registration);
    if (record.challenge.expiresAt <= now())
      return json(res, 410, { code: 'interaction_expired' });

    const result = await verifier.verifyClaims(presentation, {
      nonce: record.challenge.nonce,
      requiredClaims: REQUIRED_CLAIMS,
    });
    if (!result.valid) {
      const failure = result.failures[0];
      return json(
        res,
        isRejection(failure) ? 401 : 503,
        { code: failure.code },
        isRejection(failure)
          ? { 'WWW-Authenticate': 'Identity-Presentation' }
          : {},
      );
    }
    const { email, email_verified: emailVerified } = result.claims;
    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      emailVerified !== true
    ) {
      return json(res, 403, { code: 'verified_email_required' });
    }

    // Recheck after asynchronous verification. No await between this check and
    // committing the result: competing requests create exactly one registration
    // in this process. Use a database transaction across deployed replicas.
    if (session.expiresAt <= now())
      return json(res, 401, { code: 'session_expired' });
    if (record.registration) return json(res, 200, record.registration);
    if (record.challenge.expiresAt <= now())
      return json(res, 410, { code: 'interaction_expired' });
    record.registration = { id: randomUUID(), event_id: eventId, email };
    return json(res, 201, record.registration);
  };
}

/** Loopback server; PUBLIC_ORIGIN supports an HTTPS reverse proxy for real use. */
export async function startServer({
  port = 0,
  publicOrigin,
  fetchImpl,
  now = () => Math.floor(Date.now() / 1000),
  sessionTtlSeconds = 600,
  maxSessions = 1000,
  maxInteractions = 20,
} = {}) {
  if (
    publicOrigin &&
    (new URL(publicOrigin).origin !== publicOrigin ||
      (new URL(publicOrigin).protocol !== 'https:' &&
        !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicOrigin)))
  ) {
    throw new Error(
      'PUBLIC_ORIGIN must be an HTTPS origin or a loopback HTTP origin.',
    );
  }
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const origin = publicOrigin ?? url;
  const verifier = new LinkVerifier({ origin, fetchImpl, now });
  const handle = createHandler(verifier, {
    now,
    sessionTtlSeconds,
    maxSessions,
    maxInteractions,
  });
  server.on('request', (req, res) => {
    handle(req, res).catch((error) => {
      // Do not log credentials, disclosed values, or exceptions containing them.
      if (!res.headersSent && !res.destroyed) {
        json(res, error.status ?? 503, {
          code: error.code ?? 'service_unavailable',
        });
      }
    });
  });
  return { server, url, origin };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { url, origin } = await startServer({
    port: Number(process.env.PORT ?? 3000),
    publicOrigin: process.env.PUBLIC_ORIGIN,
  });
  console.log(`Event service: ${url} (identity audience: ${origin})`);
}
