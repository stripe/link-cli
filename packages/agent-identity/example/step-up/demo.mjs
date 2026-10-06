import {
  CredentialFixture,
  combineFetch,
  LinkFixture,
} from '@stripe/agent-identity/testing';
import { registerForEvent } from './agent.mjs';
import { startServer } from './server.mjs';

// Fixtures use real signatures and synthetic claims; no requests go to Link.
const link = await LinkFixture.create();
const credential = await CredentialFixture.create({
  issuerUrl: link.issuer,
  claims: {
    email: 'alex@example.com',
    email_verified: true,
    given_name: 'Alex',
  },
});
const { server, origin } = await startServer({
  fetchImpl: combineFetch(credential.fetchImpl(), link.fetchImpl()),
});
try {
  console.log(
    'Local fixture demo; no Link account or live credentials required.',
  );
  await registerForEvent({
    origin,
    getAttestation: async () => (await link.mint()).authorization,
    createPresentation: ({ aud, nonce, claims }) =>
      credential.present({ aud, nonce, disclose: claims }),
    onStep: (step, status) => console.log(`${status}: ${step}`),
  });
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
