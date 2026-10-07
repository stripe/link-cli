# Agent Identity: event registration with identity step-up

This example gives an agent access to an event site after it presents a Link attestation. Registering for an event requires a separate identity presentation containing a verified email. It runs over real HTTP and uses the same verifier in fixture and live modes.

The service owns its sessions and interaction state. The verifier SDK checks credential signatures, expiry, audience, required claims, and expected nonce equality. It does not create sessions or enforce nonce single use.

## Run without a Link account

From the repository root, using Node 24+ for workspace development:

```sh
pnpm install --frozen-lockfile
pnpm --filter @stripe/agent-identity build
node packages/agent-identity/example/step-up/demo.mjs
```

The demo starts a loopback server on an available port, drives it with an HTTP client, and shuts it down. Issuer metadata and keys come from local cryptographic fixtures. No requests go to Link and no live credentials are used. The fixtures sign synthetic tokens directly; this mode does not exercise Link issuance or the wallet's blinding code.

Expected output:

```text
Local fixture demo; no Link account or live credentials required.
401: Site requests a Link attestation
200: Attestation grants a site session
401: Registration requests a verified email
201: Verified email completes registration
200: Retry returns the saved registration
200: Site session retrieves the registration without new proofs
```

The client validates the identity challenge before requesting disclosure, checks its expiry again before submission, and redacts unexpected service or platform errors. It prints only step names and HTTP statuses on success. It keeps tokens, presentations, session credentials, and email values out of its output.

## What happens

| Request | Result |
| --- | --- |
| `GET /events` without credentials | `401` with a Link `PrivateToken` challenge. |
| `GET /events` with a valid AAT | `200` with events and a ten-minute application `session_token`. |
| `POST /registrations` with the session and `{"event_id":"autumn-meetup"}` | `401` requesting `email` and `email_verified`, with audience, nonce, expiry, and an application `interaction_id`. |
| Retry with the session, `X-Registration-Interaction`, and `Identity-Presentation` | `201` after verification and the application's `email_verified === true` check. |
| Retry the same interaction and event with the session | `200` returning the saved registration, without another side effect or disclosure. |
| `GET /registrations/<id>` with the same session | `200` with that session's registration. A different session receives `404`. |

The application session uses `Authorization: Bearer <session_token>` after site admission. It is a credential issued by this example service, not the agent's Link OAuth access token. The session grants browsing, requesting a registration challenge, and reading its own completed registrations. Each new registration requires a fresh claims interaction. The example accepts an AAT once when creating a session; it does not enforce AAT single use or claim that the AAT and identity credential share a holder.

Each interaction is scoped to the session and event. Its expected nonce comes from server state. Invalid or incomplete presentations leave the interaction pending so the agent can correct them. The application rejects pending interactions after five minutes and checks expiry again after asynchronous verification. In the single-process store, checking completion and saving the registration happen synchronously. Concurrent successful retries therefore create one registration and return the same result.

Completed results remain available until session expiry. Retrying requires the same bearer session, interaction ID, and event; possession of an interaction ID alone grants no access. A service session has its own lifetime, independent of the credential's expiry and Link OAuth revocation.

## Run with Link Agent Wallet

Use Link Agent Wallet with identity issuance access on your Link account. The example uses `identity attestations pop` and `identity credentials present`. Choose an installed wallet that supports both, or build the wallet from this checkout before preparing credentials:

```sh
# From the repository root:
pnpm exec turbo run build --filter=./packages/cli
chmod +x packages/cli/dist/cli.js
export LINK_WALLET_BIN="$PWD/packages/cli/dist/cli.js"
```

For an installed wallet, use `export LINK_WALLET_BIN="$(command -v link-cli)"` instead. Use the same executable for sign-in, issuance, and the demo client. Authenticate it using the wallet's [sign-in instructions](../../../../README.md#authentication-1), invoking `"$LINK_WALLET_BIN"` wherever those instructions use `link-cli`. These commands are Unlisted; enable them before preparing the wallet:

```sh
export LINK_IDENTITY_COMMANDS=1
"$LINK_WALLET_BIN" identity attestations request --count 10 --format json
"$LINK_WALLET_BIN" identity credentials request --format json
```

Those commands save credentials and return metadata. From `packages/agent-identity`, start the service in one terminal with live Link public-key discovery:

```sh
node example/step-up/server.mjs
```

From the same directory in another terminal, enable identity and select the same wallet executable again before running the client:

```sh
export LINK_IDENTITY_COMMANDS=1
export LINK_WALLET_BIN="$(cd ../cli && pwd)/dist/cli.js"
# For an installed wallet instead: export LINK_WALLET_BIN="$(command -v link-cli)"
node example/step-up/agent.mjs http://127.0.0.1:3000 --share-email
```

`--share-email` permits this run to disclose your Link email and its verification status to the specified event service. The client calls `pop` once and calls `present --aud ... --nonce ... --claim email --claim email_verified` for the service's challenge. It reads JSON output programmatically and passes the proofs directly into HTTP headers. It does not read the private key, print proofs, follow redirects, or keep retrying rejected requests. A missing/expired credential, empty pool, or wallet without `pop` produces an error; prepare the wallet before retrying.

The wallet handles issuance. This service only fetches Link's public metadata and verification keys; it does not call issuance endpoints.

For an agent using its own HTTP client or browser automation, provide the service URL and ask:

> Use Link Agent Wallet to access the event list and register me for the Autumn meetup. I authorize sharing my Link email and verification status with this service. Answer its attestation challenge, retain the returned application session, and answer the registration challenge using the requested audience and nonce. Read and forward proofs programmatically without transcribing or printing them. Keep the interaction ID for retries and show only whether registration succeeded.

## Files and checks

- `server.mjs`: the service and its bounded in-memory application state. Standalone mode uses Link's public discovery.
- `agent.mjs`: the HTTP flow, with callbacks for obtaining proofs; executable mode calls the wallet.
- `demo.mjs`: synthetic issuer/holder fixtures and the local demo.
- `server.test.mjs`: HTTP acceptance, rejection, concurrency, expiry, session isolation, input validation, and client disclosure/redirect tests.

```sh
node --test packages/agent-identity/example/step-up/server.test.mjs
```

Build the SDK first. The example imports Agent Identity through its public exports. CI runs its tests on Node 24 and in the package compatibility check on Node 22.

## Deployment boundaries

This is a single-process, in-memory example. It caps sessions and interactions, and state disappears on restart. Before deployment, use shared storage and a transaction that checks the pending interaction, creates the registration, and saves its result atomically. If registration invokes another service, use an idempotency key or transactional outbox and retain recovery state. Add deployment-specific rate limits and session revocation, protect stored email data, and define retention.

The server binds to loopback. Use HTTPS in deployment and set `PUBLIC_ORIGIN=https://events.example` behind your HTTPS reverse proxy. Set `PORT` to change the local listener. `PUBLIC_ORIGIN` is trusted configuration, never derived from request headers. Browser cross-origin use also needs an explicit CORS policy; this example does not enable one.

A valid AAT proves Link issuance, not the presenter's identity. A Link-signed email is not sufficient for this registration policy unless `email_verified` is present and `true`. Application sessions and registration permissions are decisions made by this example service.
