# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Link CLI — lets agents get secure, one-time-use payment credentials from a Link wallet. pnpm + Turborepo monorepo:

- **`@stripe/link-sdk`** (`packages/sdk`): Typed Link API client and resource implementations. It accepts `accessToken` or `getAccessToken`; it does not own OAuth state. Entry: `src/index.ts`.
- **Link Go SDK** (`packages/sdk-go`): Go equivalent of `@stripe/link-sdk`. It accepts `AccessToken` or `GetAccessToken`; it does not own OAuth state. Package name: `link`.
- **Link Python SDK** (`packages/sdk-python`): Python 3.11+ library covering the Go SDK's API resources with Python conventions. Distribution name: `link-sdk`; import name: `link`. HTTPX `Client` and `AsyncClient` expose typed keyword arguments and Pydantic response models. Uses uv for Python, dependencies, environments, builds, and development commands.
- **`@stripe/link-integrations-better-auth`** (`packages/integrations/better-auth`): Generic OAuth wrapper for Link sign-in and connecting wallets. Link's stable `/userinfo.id` identifies the provider account, using the SDK's `UserInfo` type through a development dependency. The `/client` export provides `linkClient()`: `link.connect()` wraps native `linkSocial`, while `link.disconnect()` checks an authoritative fresh session, ownership, provider, and last-account policy before revoking the stored refresh token and deleting the account. Revocation failures retain the account and credentials. Better Auth owns OAuth state, token storage, and refresh; wallet API calls remain in the SDK.
- **`@stripe/link-cli`** (`packages/cli`): Commander.js + Ink/React CLI that consumes `@stripe/link-sdk`. Entry: `src/cli.tsx`.

## Commands

```bash
pnpm install                    # install dependencies
pnpm run build                  # build all packages (turbo)
pnpm run dev                    # watch mode
pnpm run test                   # run all tests
pnpm run test:go                # run the Go SDK tests
pnpm run test:python            # run the Python SDK tests via uv
pnpm run check:python           # Python Ruff lint/format checks and ty type checking
pnpm run typecheck              # type-check all packages
pnpm biome check .              # lint + format check (CI)
pnpm run check                  # lint + format with auto-fix
```

Run a single test:
```bash
cd packages/cli && pnpm vitest run src/utils/__tests__/line-item-parser.test.ts
```

The CLI integration tests in `packages/cli/src/__tests__/cli.test.ts` run against the compiled `dist/cli.js`. Run `pnpm run build` before running them if the source has changed.

Run the CLI locally:
```bash
node packages/cli/dist/cli.js <command>
```

## Architecture

### SDK Resources

Defined in `packages/sdk/src/resources/interfaces.ts`:
- `IAttestationsResource` — Privacy Pass Blind RSA token issuance
- `IIdentityCredentialsResource` — signed user info issuance
- `ISpendRequestResource` — CRUD + request-approval for spend requests

The SDK only accepts credentials. Device authorization, refresh-token
persistence, login state, and auth-specific errors live under
`packages/cli/src/auth/`.

The Go SDK currently mirrors the Link API resources exposed by the TypeScript
SDK. Until a server-owned OpenAPI schema is available, keep API changes aligned
through implementation review and each package's unit tests.

The Python SDK mirrors the current Go SDK resources and parameters. Shared
request construction and decoding live in `packages/sdk-python/src/link/_operations.py`
and `_transport.py`; explicit sync/async resource signatures must stay aligned.
Python responses preserve unknown string enum values and the extra fields
preserved by Go. Required response fields have no fabricated zero-value defaults;
Pydantic error text hides input values. Request enums use narrow literal types.
SDK-owned HTTP clients default to a 30-second timeout, configurable with
`timeout=`; omitted timeouts respect an injected client's configuration.
Use `uv run --directory packages/sdk-python --locked ...` from
the repository root so tools load the Python project's configuration. Run
`uv build --directory packages/sdk-python` to build locally; Python publishing
is not configured.

### CLI Command Structure

Commands in `packages/cli/src/cli.tsx` (incur framework). Each has two output modes:
- **Interactive** (default): Ink/React components from `packages/cli/src/commands/`
- **JSON** (`--format json`): JSON to stdout, errors as JSON with `code` and `message` fields with exit code 1

Commands: `auth login|logout|status`, `user-info retrieve`, `spend-request create|update|retrieve|request-approval|cancel`, `payment-methods list|retrieve|add|update`, `shipping-address list`, `mpp pay|decode`, `identity attestations request|list|take`, `identity credentials request|list|present`, `report`, `serve`.

The CLI also runs as an MCP server (`--mcp`) and serves skill files via `skills` subcommand, both provided by incur.

**When changing commands, flags, or schema descriptions, always update all four together:** `README.md`, `skills/create-payment-credential/SKILL.md`, the schema description strings in the relevant `schema.ts` file, and `CLAUDE.md`. These can easily drift apart.

Input is passed via flags. Define options in the command's zod schema — incur registers CLI flags automatically from the schema.

### auth login

- `auth login --client-name <name>` — optional flag to identify the agent or app; shown in the user's Link app as `<name> on <hostname>`. Defined in `loginOptions` in `packages/cli/src/commands/auth/schema.ts`.
- `auth login --interval <seconds> [--timeout <seconds>] [--max-attempts <n>]` — when `--interval` is provided, the command yields the verification code immediately then polls inline until authenticated or timed out. Without `--interval`, returns the code with a `_next` hint for separate polling via `auth status`.
- The token endpoint echoes `scope` and `authorization_details` back with the tokens on login/refresh. These are persisted in the credential file (part of `AuthTokens`) and surfaced on `auth status` in both interactive and JSON modes, only when present.
- `packages/cli/src/auth/auth-resource.ts` owns device authorization, token parsing, refresh, and revocation. `ResourceFactory` exposes the resulting access token to SDK resources through `getAccessToken`.

### auth upgrade

- `auth upgrade` — takes the **same flags** as `auth login` (reuses `loginOptions`; `--client-name`, `--scope`, `--source-actions`, `--authorization-detail`, `--interval`/`--timeout`/`--max-attempts`) and starts a new device-authorization requesting a **superset** of the current access. Implemented alongside `login` in `createAuthCli` (`packages/cli/src/commands/auth/index.tsx`); `auth login` is unchanged. The device-auth tail (initiate → yield code → poll) is shared with `login` via the `startDeviceAuthAndPoll` helper.
- Where `auth login` bails out with "already logged in" when a valid session exists, `auth upgrade` **never bails**: it refreshes the existing token, merges the requested `scope`/`authorization_details` with the currently granted access via `computeMergedAccess` (`packages/cli/src/auth/merge-access.ts`, returning `mergedScope` + `mergedAuthorizationDetails`), and initiates device auth for the union.
- If the existing token is invalid or absent, it writes a warning to **stderr** and includes a `warning` field in the JSON yield, then continues with only the requested access (never hard-fails). `--source-actions` are folded into `authorization_details` before merging (via `buildAuthorizationDetails`), so `source` merges by `type` like any other detail.
- **Deferred session replacement (key invariant).** Upgrade does **not** clear or revoke the current session up front — the existing grant stays valid throughout the pending approval, so a failed `initiateDeviceAuth` or an abandoned approval leaves it usable. The refreshed tokens are persisted; the pending device-auth record is flagged `replaces_existing_session` (field on the CLI-owned `PendingDeviceAuth` in `packages/cli/src/auth/storage.ts`). `pollAuthStatus` completes a flagged pending **even while `isAuthenticated()` is true** (it doesn't report the old session as done), and on success swaps in the new tokens and **revokes the old grant**. The interactive path does the same via the `<Login>` `revokeRefreshTokenOnSuccess` prop. Abandon → the flagged pending expires (auto-cleared by `getPendingDeviceAuth`) and the old session remains.
- Scope-token comparison for the merge tolerates commas (the token endpoint echoes `scope` back comma-delimited) — but only inside `merge-access.ts`. `auth login`'s `--scope` parsing (`normalizeScopeInput` in `scopes.ts`) remains strictly space-separated, so `login` is genuinely unchanged.

### spend-request command

CLI command is `spend-request` (user-facing). Implemented in `packages/cli/src/commands/spend-request/`. SDK interfaces: `ISpendRequestResource`, `CreateSpendRequestParams`, `UpdateSpendRequestParams`. API endpoint: `/spend_requests`.

Key input field notes:
- CLI input uses `payment_method_id`; mapped to `payment_details` when calling the SDK
- `--execution-method link_pay_token` and `--merchant-account-id acct_...` are a create-only pair for Link Pay Token checkout. The agent reads the account ID from `data-stripe-merchant-account` in the AI-agent steering DOM before creating the request; Link resolves the canonical merchant identity. LPT uses `credential_type: card`, cannot use `--test` or `--network-id`, and must not accept agent-provided merchant name or URL. Never add the target fields to the update path.
- `context` requires min 100 characters; `amount` is in cents with max 500000
- `--metadata` (create only) is a repeatable `key:value` flag (CLI) or a `{ key: value }` object (MCP/agent), merged into a single `metadata` string→string map. Max 50 keys, key ≤ 40 chars, value ≤ 500 chars. Reuses `parseKvString` from `line-item-parser.ts`.
- `--test` flag creates testmode credentials (real testmode SPT from test card data) instead of livemode ones
- `create --request-approval` and `request-approval` both show an approval URL in interactive mode and poll until the request leaves `created`/`pending_approval`. `submitted` is a supported terminal status. In JSON mode (`--format json`), waiting requests return immediately with an `_next.command` for `spend-request retrieve`.
- `retrieve --interval <seconds>` waits for the initial status to change. Polling starts only for `created`, `pending_approval`, or `requires_action` with `auto_resume`; all other statuses (including `submitted` and unknown future values) return immediately. Any status change returns, even to another waiting state. JSON and interactive retrieve share `shouldPollSpendRequest`. If `--timeout` or `--max-attempts` is reached without a change, JSON polling exits non-zero with `POLLING_TIMEOUT`.
- Both `create` and `retrieve` (including approval polling) can return `status: 'requires_action'` with `status_details.requires_action.next_action` (`type`, `display_message`, `action_url`, `resolution`). With `resolution: 'auto_resume'` (currently only `next_action.type: 'three_d_secure'`), retrieve the same request again to wait for its status to change; interactive create resumes automatically. Any other resolution stops polling immediately; the caller must have the user complete the action, then create a new spend request.
- `cancel <id>` cancels a spend request. Can cancel from `created`, `pending_approval`, or `approved` states. Returns the spend request with `status: "canceled"`.
- `--approval-detail` — optional JSON object (MCP/agent) or JSON string (CLI) with approval details for delegated flows. Required fields: `approved_at` (unix timestamp int), `approval_method` (`click`|`programmatic`|`voice`), `app_name`, `external_user_id`. Optional: `ip_address`, `user_agent`, `device_type` (`mobile`|`web`), `agent_log_id`, `external_user_name`, `external_session_id`, `authentication_method` (`biometric_face`|`biometric_fingerprint`|`passkey`). Sent as `approval_details` in the API request body.
- `card` credentials include `billing_address` (name, line1, line2, city, state, postal_code, country) and `valid_until` (ISO date string — when the card expires/stops working)
- `--output-file <path>` on `retrieve` or `create` writes full card credentials to a local file (0600 permissions) and redacts card data in stdout. `--force` allows overwriting an existing file.
- `create` also accepts an undocumented `--expires-at <unix_seconds>` to override the default 12-hour spend request expiration (3 hours to 7 days in the future). It's deliberately excluded from `--schema`/`--llms-full` output and from README/SKILL.md: it's gated to an allow-list of OAuth clients server-side, and most callers get a 400 (`"expires_at is not supported for this client"`) if they try it — don't document or suggest it to general agents.

### payment-methods command

- `payment-methods update <id> --nickname <nickname>` requires a positional payment-method ID and the `--nickname` option.
- An explicit empty nickname (`--nickname ""`) clears the nickname. Omission is invalid.
- Clients pass the exact string; the server trims surrounding whitespace and validates length.
- TypeScript, Go, and Python SDK implementations must all preserve explicit empty strings in the JSON request body.

### user-info retrieve

- `user-info retrieve` returns the existing identity fields and can include `address`, `eligible_for_balance`, `agent_wallet_spend_limits`, and `agent_wallet_verification_requirement` enrichment.
- `address` contains nullable `line1`, `line2`, `city`, `state`, `postal_code`, and `country` fields. It is itself `null` when the user has no Person record. `eligible_for_balance` indicates whether balance is available for Agent Wallet usage.
- Spend limits contain per-transaction, daily, and 30-day values. Finite values are cents because `/userinfo` does not return currency. A `null` limit or remaining amount explicitly means unlimited; `used` remains numeric.
- Enrichment fields can be omitted when enrichment is disabled or unavailable. Do not interpret omission as an empty address, balance ineligibility, unlimited spend, or a default verification status.
- Verification status is one of `not_required`, `ssn_verification`, `identity_verification`, `contact_support`, or `complete`. `action_url` is nullable and directs the user to the required action when present. This is informational and does not change spend-request or `requires_action` handling.

### mpp pay

- `mpp pay <url> --context <ctx> [-X <method>] [-d <body>] [-H <header>]... [--amount <cents>] [--payment-method-id <id>] [--test]` — handles the full MPP flow end-to-end: probes the URL for a 402 challenge, parses the `www-authenticate` header to extract network_id and amount, creates a spend request (credential_type: shared_payment_token), gets user approval, retrieves the SPT, and pays. Amount/currency are derived from the 402 challenge; `--amount` overrides. `--context` is required (min 100 chars) — describe the purchase and rationale. Default payment method is used unless `--payment-method-id` is specified.
- `mpp pay <url> --spend-request-id <id> [--method <method>] [--data <body>] [--header <header>]...` — backward-compat mode: uses a pre-approved spend request directly, skipping creation/approval.
- `--header` is repeatable and uses `"Name: Value"` format. `Content-Type: application/json` is auto-applied when `--data` is provided; user-provided headers take precedence.
- The SPT is one-time-use — a failed payment requires running `mpp pay` again (creates a new spend request).
- In agent mode the full flow yields `_next.pay_argv` (`{ command: 'mpp', args: [...] }`) alongside `_next.pay_command`. **`pay_argv` is authoritative** — it holds the raw values and is meant to be invoked without a shell. `pay_command` is the compatibility string and every dynamic part of it (url, method, body, each header, spend-request id) must go through `shellQuote` from `packages/cli/src/utils/shell-quote.ts`. See "Security: shell-quoting command strings".
- Implemented in `packages/cli/src/commands/mpp/` — pay.tsx (logic), schema.ts (input/output schema), index.tsx (incur registration).

### demo command

- `demo [--only-card] [--only-spt]` — Interactive demo of both payment flows. Always uses `--test` mode (no real charges). Shows a menu to choose: virtual card flow, SPT/machine payment flow, or both. `--only-card` and `--only-spt` skip the menu. Requires a TTY (no JSON output mode).

### onboard command

- `onboard` — Guided setup: authenticates (skips if already logged in), checks payment methods (prompts to add one if missing, shows picker if multiple), shows app download QR code, then runs the full demo. Requires a TTY.

### identity attestations command

Unlisted: omitted from `--help`, `--llms`, and MCP tool lists unless `LINK_IDENTITY_COMMANDS=1` (or `true`). Even when enabled, the command sets `mcp: false` so MCP clients do not see it.

`identity attestations request --count <n>` — gets privacy-preserving tokens that show Link attests to your agent. Agent-only output. The SDK owns issuance in `packages/sdk/src/resources/attestations.ts` and `attestations-crypto.ts`; CLI schema and registration remain in `packages/cli/src/commands/attestations/`, mounted under `packages/cli/src/commands/identity/`.

- Discovery: `GET https://api.link.com/.well-known/aap-issuer` → metadata, then `GET` its `token_keys` URL. The metadata issuer and every discovered endpoint must stay on the Link API's HTTPS DNS origin; redirects and IP-literal hosts are rejected before credentials are sent.
- Tokens use a stable challenge: fixed `issuer_name`, empty `redemption_context`, and empty `origin_info`.
- `attestations-crypto.ts` implements the RFC 9578 type `0x0002` client flow: PSS-encode, blind, unblind, verify, then assemble the token. Issuer keys must be 2048-bit RSA-PSS with SHA-384, MGF1-SHA-384, and a 48-byte salt.
- Blind signatures are verified after unblinding before final tokens are returned.
- Output is a versioned artifact: issuer, `token_key_id`, and each complete base64url token plus `authorization: PrivateToken token="<token>"`. Token bytes are preserved exactly.
- Default requests append batches to `~/.link-cli/attestations/pool.json` (version 2, mode 0600; directory mode 0700). `request --count <n> --output-file <path>` exports a version-1 batch outside that directory without adding it to the pool. Exports use exclusive creation; existing files are not overwritten. Request output contains the path and metadata.
- Unlisted `identity attestations take` removes one pooled token and returns its bytes, generated `authorization` header, issuer, and key ID in both terminal and structured output. It uses no API resource and returns `ATTESTATION_POOL_EMPTY` when empty. `storage.ts` serializes append/take with an exclusive directory lock, fsyncs a private temporary file, atomically renames it, and fsyncs the directory on POSIX before returning. Windows uses file fsync and atomic rename because Node cannot fsync a directory there. Locks are never stolen based on age; after a crash, remove `pool.json.lock` only after ensuring no attestation commands are running. A crash after commit may lose a token; never reinsert it on output failure.
- Server-side max batch is 100. Issuance does not require an additional OAuth scope.
- Auth: standard CLI authentication (`LINK_ACCESS_TOKEN` or stored credentials).
- Unlisted local inspection: `identity attestations list` reports saved batch paths, issuer/key identifiers, per-file `stored_token_count` and aggregate `total_token_count`, and per-file `errors`. It reads JSON batches in `~/.link-cli/attestations`, expanding the pool into batches marked `storage: pool`; legacy exports are marked `storage: export` and never imported automatically. Counts describe stored tokens; external usage is untracked. The command works without auth or API calls, prints metadata in terminals and structured output (`outputPolicy: 'all'`), and preserves the feature gate and MCP exclusion. The version-1 export schema lives in `export.ts`, the version-2 pool schema in `storage.ts`, and shared file reading in `identity/artifact-reader.ts`.

### report command

- `report --domain <d> --outcome <success|blocked|abandoned> --spend-request-id <lsrq_...> [--tag <t>]... [--step <s>] [--freeform-context <s>] [--attempt-trace <s>]` — records the outcome of a purchase attempt. Options in `packages/cli/src/commands/report/schema.ts`, SDK params in `CreateReportParams`. API endpoint: `/agent_observations`. Output policy is `agent-only`.
- `--step` is where the agent was when the outcome occurred (max 500). `--attempt-trace` is the whole path it took, one numbered line per step, intended to be replayable by another agent. Both are optional and independent.
- `--attempt-trace` intentionally carries **no** zod `.max()`. The API truncates at `REPORT_ATTEMPT_TRACE_MAX_LENGTH` (8000, exported from the SDK) and still records the report, so client-side rejection would trade a long narrative for a lost outcome. `--step` and `--freeform-context` keep their `.max(500)` because the API rejects those outright.

### identity credentials command

Unlisted: omitted from `--help`, `--llms`, and MCP tool lists unless `LINK_IDENTITY_COMMANDS=1` (or `true`). Even when enabled, the command sets `mcp: false` so MCP clients do not see it.

`identity credentials request` requests signed user info proving it comes from Link (a wallet of claims such as name, email, and phone). Like `identity attestations request`, it saves the full artifact and returns only its path and metadata in every output mode, including JSON, pipes, and `--full-output`. Human TTY runs show the saved path and expiry; structured output includes `output_file`, issuer, expiry, holder-key path/thumbprint, and claim names. Credentials and claim values remain in the saved file for scripts to use with the holder key when signing presentations. Neither request command has an option to include secret contents in its output. The SDK discovers and calls `credential_endpoint`; the CLI owns default holder-key persistence, claim decoding, and command registration under `packages/cli/src/commands/identity/`.

- Discovery uses `GET https://api.link.com/.well-known/aap-issuer`. The metadata issuer must be exactly `https://api.link.com`, and `credential_endpoint` must remain on that HTTPS origin. `LINK_API_BASE_URL` does not change the credential issuer.
- `POST <credential_endpoint>` sends `{"cnf":{"jwk":<public JWK>}}`.
- Issuance uses the Ed25519 holder key at `~/.link/holder-key.jwk` (mode 0600).
- The issued `cnf.jwk` is checked against the requested public key before returning the credential artifact.
- Unlisted local inspection: `identity credentials list` inspects `~/.link-cli/credentials/current.json` for its path, issuer, cached expiry/`expired` status, holder-key path/thumbprint, and claim names. It never opens the private key or prints credential bytes or claim values. The command works without auth or API calls, uses `outputPolicy: 'all'`, and preserves the feature gate and MCP exclusion. Inspection validates saved metadata without verifying signatures or scoping files to the active account.

- Unlisted presentation: `identity credentials present --aud <audience> --nonce <nonce> --claim email [--claim email_verified]` reads the current saved credential and existing holder key without auth or API calls. It returns `{ presentation }` with `outputPolicy: 'all'`, including terminal output, and remains excluded from MCP. `present.ts` selects original encoded disclosures, preserves the issuer JWT, and signs an Ed25519 `kb+jwt` containing the exact audience, nonce, current `iat`, and SHA-256 `sd_hash` over the selected SD-JWT including its trailing tilde. It requires explicit claims, checks validity and the holder key against the issuer JWT, and rejects unsupported nested disclosures or plaintext user claims. It does not regenerate keys, modify artifacts, or verify the issuer signature locally; the recipient verifier owns signature verification and nonce consumption. Clients should capture the sensitive presentation and send it as `Identity-Presentation`, without logging it.

### serve command

- `serve [--port <n>] [--host <host>]` — HTTP server that exposes the CLI's MCP endpoint. Implemented in `packages/cli/src/commands/serve/index.ts`. The handler forwards to `rootCli.fetch()` (incur), but is a **privilege boundary**: `requireAuth` only proves the CLI *owner* is authenticated, not that the HTTP caller is authorized.
- Parse each HTTP request target once and reuse that URL for routing and dispatch. Accept only unambiguous origin-form paths; return `400` for malformed targets. Only forward `POST /mcp` and the supported `GET` skill discovery routes (index and `SKILL.md`); handle `OPTIONS` locally. Missing `Origin` does not prove a caller is outside the browser. Security regressions in `packages/cli/src/__tests__/serve.test.ts` exercise raw request targets against the built CLI.

## Code Conventions

- **ESM everywhere** — `"type": "module"` in all package.json files
- **Biome** — 2-space indent, single quotes, organized imports
- **tsup** — ESM output; Node 20 target for the SDK and Node 18 target for the CLI
- **Vitest** — test files in `__tests__/` directories adjacent to source
- **TypeScript strict mode** — `tsconfig.base.json` at root
- **React 18 + Ink 5** for interactive rendering
- **`conf`** for local auth token storage

## Global Flags

| Flag | Effect |
|------|--------|
| `--auth <path>` | Store auth credentials in a specific file instead of the default platform config location. `auth login` writes to this file; all other commands read from it. Parsed from `process.argv` and stripped before incur processes flags. |

## Security: Terminal Output Sanitization

Server-returned strings can contain ANSI escape sequences or control characters that spoof the terminal approval UI. Sanitization is handled automatically via `sanitizeDeep()` from `packages/cli/src/utils/sanitize-text.ts`:

- **SDK-resource data** — sanitized automatically at the `sanitizeResource()` proxy boundary in `packages/cli/src/utils/resource-factory.ts`. All server data flowing through SDK resources (spend-request, payment-methods, sources, etc.) is `sanitizeDeep()`'d before reaching components or the incur formatter, in every output format.
- **Encoded server data decoded by the CLI** — must be sanitized after decoding. Credential issuance sanitizes claims recovered from SD-JWT disclosures in `commands/credentials/issue.ts`; sanitizing the compact credential string at the resource boundary does not sanitize its decoded values.
- **Commands using `useAsyncAction` hook** — sanitized automatically. The hook calls `sanitizeDeep()` on all returned data before it reaches components.
- **Commands with manual state management** (e.g. `create.tsx`, `retrieve.tsx`, `request-approval.tsx`, `mpp/pay.tsx`) — must call `sanitizeDeep()` on API responses before calling `setRequest()`/`setState()`.
- **Attacker-controlled data that does NOT flow through an SDK resource** — must be sanitized at its own parse boundary. `mpp pay` sanitizes the HTTP response in `readPayResult()` (`pay.tsx`); `mpp decode` sanitizes the parsed `WWW-Authenticate` challenge in `decodeStripeChallenge()` (`decode.ts`). These bypass the resource factory, so the return value of the parse/fetch helper is the chokepoint — sanitizing there covers both the interactive Ink render and the agent (toon/yaml/md) output at once.

JSON output mode (`--format json`) is **not** affected — `JSON.stringify` encodes escape sequences as Unicode literals.

## Security: Shell-Quoting Command Strings

Any string the CLI emits for an agent to *run* (`instruction`, `_next.command`, `_next.pay_command`) is a shell-injection sink. Agents commonly execute these through Bash, so interpolating an unquoted value there gives whoever controls that value command execution on the agent's host — even though the value was safe as an argv entry. Sanitization does not help: `$(...)`, backticks and `;` are ordinary printable characters.

Rules:

- Every dynamic value interpolated into a command string goes through `shellQuote()` from `packages/cli/src/utils/shell-quote.ts`, or the whole argv list through `shellCommand()`. This applies to server-issued IDs too — uniform treatment removes the "is this field trusted?" judgment call from future edits.
- Prefer emitting a **structured** continuation next to the string (`_next.pay_argv` = `{ command, args }`) and point agents at it. A list of arguments has no seam to smuggle syntax through; a string always does.
- Naive `'${value}'` wrapping is **not** quoting — a single `'` in the value closes it and escapes.
- Regression coverage lives in `packages/cli/src/utils/__tests__/shell-quote.test.ts` (bash round-trip) and the `_next continuation quoting` block in `packages/cli/src/__tests__/cli.test.ts`.

## Environment Variables

| Variable | Effect |
|----------|--------|
| `LINK_AUTH_FILE` | Same as `--auth` — override the auth credential file path (flag takes precedence) |
| `LINK_ACCESS_TOKEN` | Use this access token directly, bypassing auth storage |
| `LINK_REFRESH_TOKEN` | Refresh token to use when `LINK_ACCESS_TOKEN` is expired |
| `LINK_NO_REFRESH` | When set, never auto-refresh the access token — error instead |
| `LINK_API_BASE_URL` | Override API base URL |
| `LINK_AUTH_BASE_URL` | Override auth base URL |
| `LINK_HTTP_PROXY` | Route all SDK requests through an HTTP proxy (requires `undici` installed) |
| `LINK_IDENTITY_COMMANDS` | When `1` or `true`, register the unlisted `identity` command group. Omitted from `--help`, `--llms`, and MCP otherwise. |
