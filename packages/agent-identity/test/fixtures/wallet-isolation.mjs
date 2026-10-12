// Loaded before the wallet so its default storage and fetches stay in this test.
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';

const { LINK_TEST_WALLET_HOME, LINK_TEST_BROKER } = process.env;
if (!LINK_TEST_WALLET_HOME || !LINK_TEST_BROKER) {
  throw new Error(
    'Wallet integration test requires isolated storage and issuer.',
  );
}
const broker = new URL(LINK_TEST_BROKER);
if (broker.protocol !== 'http:' || broker.hostname !== '127.0.0.1') {
  throw new Error('Wallet test issuer must be on loopback.');
}

os.homedir = () => LINK_TEST_WALLET_HOME;
syncBuiltinESMExports();

const localFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (new URL(url).origin !== 'https://api.link.com') {
    throw new Error('Unexpected wallet network request.');
  }
  return localFetch(broker, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: init.signal ?? AbortSignal.timeout(10_000),
    body: JSON.stringify({
      url,
      init: {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        body: init.body,
      },
    }),
  });
};
