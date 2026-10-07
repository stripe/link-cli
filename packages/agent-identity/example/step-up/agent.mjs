import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Only these locally authored messages are safe to print. Platform errors can
// include response bodies, credential headers, or wallet output.
class ClientError extends Error {}

// This example server uses 32 random bytes. The SDK accepts other nonce formats.
const isOpaqueToken = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const includesString = (values, expected) =>
  Array.isArray(values) &&
  values.every((value) => typeof value === 'string') &&
  values.includes(expected);

/** An HTTP client for this example, with caller-owned credential providers. */
export async function registerForEvent({
  origin,
  getAttestation,
  createPresentation,
  onStep = () => {},
  fetchImpl = fetch,
}) {
  const target = new URL(origin);
  if (
    target.origin !== origin ||
    (target.protocol !== 'https:' &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
  ) {
    throw new ClientError('Use an HTTPS origin or a loopback HTTP origin.');
  }
  async function send(path, init = {}) {
    // All paths are fixed by this client. Never follow a redirect with proofs.
    return fetchImpl(`${origin}${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  }
  function expect(response, status, step) {
    onStep(step, response.status);
    if (response.status !== status)
      throw new ClientError(
        `${step}: expected HTTP ${status}, received ${response.status}`,
      );
  }

  const challengeResponse = await send('/events');
  expect(challengeResponse, 401, 'Site requests a Link attestation');
  if (
    !challengeResponse.headers
      .get('www-authenticate')
      ?.startsWith('PrivateToken ')
  ) {
    throw new ClientError('Expected a Link attestation challenge.');
  }
  await challengeResponse.arrayBuffer();
  const site = await send('/events', {
    headers: { Authorization: await getAttestation() },
  });
  expect(site, 200, 'Attestation grants a site session');
  const { session_token: sessionToken } = await site.json();
  if (!isOpaqueToken(sessionToken))
    throw new ClientError('Missing or malformed site session.');

  const registrationRequest = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_id: 'autumn-meetup' }),
  };
  const challengeResult = await send('/registrations', registrationRequest);
  expect(challengeResult, 401, 'Registration requests a verified email');
  const challenge = await challengeResult.json();
  const requested = challenge?.claims;
  if (
    challengeResult.headers.get('www-authenticate') !==
      'Identity-Presentation' ||
    challenge?.type !== 'urn:stripe:link:claims-required' ||
    challenge.aud !== origin ||
    challenge.event_id !== 'autumn-meetup' ||
    !isOpaqueToken(challenge.nonce) ||
    !isOpaqueToken(challenge.interaction_id) ||
    !Number.isSafeInteger(challenge.expires_at) ||
    challenge.expires_at <= Math.floor(Date.now() / 1000) ||
    !Array.isArray(requested) ||
    requested.length !== 2 ||
    !requested.includes('email') ||
    !requested.includes('email_verified') ||
    !includesString(challenge.formats, 'dc+sd-jwt') ||
    !includesString(challenge.trusted_issuers, 'https://api.link.com')
  ) {
    throw new ClientError(
      'Unexpected identity challenge (invalid or expired); no claims were disclosed.',
    );
  }
  // In an interactive agent, this callback is also the disclosure-consent boundary.
  const presentation = await createPresentation(challenge);
  if (challenge.expires_at <= Math.floor(Date.now() / 1000))
    throw new ClientError(
      'Identity challenge expired before submission; request a new interaction.',
    );
  const submitted = await send('/registrations', {
    ...registrationRequest,
    headers: {
      ...registrationRequest.headers,
      'X-Registration-Interaction': challenge.interaction_id,
      'Identity-Presentation': presentation,
    },
  });
  expect(submitted, 201, 'Verified email completes registration');
  const registration = await submitted.json();

  // A lost success response can be recovered with the session and interaction ID.
  // The presentation is no longer required and the side effect is not repeated.
  const retried = await send('/registrations', {
    ...registrationRequest,
    headers: {
      ...registrationRequest.headers,
      'X-Registration-Interaction': challenge.interaction_id,
    },
  });
  expect(retried, 200, 'Retry returns the saved registration');
  const saved = await retried.json();
  if (saved.id !== registration.id)
    throw new ClientError('Retry created a second registration.');

  const receipt = await send(
    `/registrations/${encodeURIComponent(registration.id)}`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
  );
  expect(
    receipt,
    200,
    'Site session retrieves the registration without new proofs',
  );
  await receipt.arrayBuffer();
  return registration;
}

async function walletJson(args) {
  try {
    const { stdout } = await promisify(execFile)(
      process.env.LINK_WALLET_BIN ?? 'link-cli',
      ['identity', ...args, '--format', 'json'],
      { maxBuffer: 1024 * 1024, timeout: 30_000 },
    );
    return JSON.parse(stdout);
  } catch {
    throw new ClientError(
      'Wallet command failed. Check the executable in LINK_WALLET_BIN (or link-cli on PATH), wallet version, sign-in, attestation pool, and credential expiry.',
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv.includes('--share-email')) {
    console.error(
      'Pass --share-email to permit sharing your Link email and verification status with this event service.',
    );
    process.exitCode = 1;
  } else {
    try {
      await registerForEvent({
        origin: process.argv[2],
        getAttestation: async () =>
          (await walletJson(['attestations', 'pop'])).authorization,
        createPresentation: async ({ aud, nonce }) =>
          (
            await walletJson([
              'credentials',
              'present',
              '--aud',
              aud,
              '--nonce',
              nonce,
              '--claim',
              'email',
              '--claim',
              'email_verified',
            ])
          ).presentation,
        onStep: (step, status) => console.log(`${status}: ${step}`),
      });
    } catch (error) {
      console.error(
        error instanceof ClientError
          ? error.message
          : 'Registration failed. Check the service response and try again.',
      );
      process.exitCode = 1;
    }
  }
}
