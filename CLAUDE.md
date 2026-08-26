# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Link CLI — lets agents get secure, one-time-use payment credentials from a Link wallet. pnpm + Turborepo monorepo:

- **`@stripe/link-sdk`** (`packages/sdk`): Typed Link API client and resource implementations. It accepts `accessToken` or `getAccessToken`; it does not own OAuth state. Entry: `src/index.ts`.
- **`@stripe/link-cli`** (`packages/cli`): Commander.js + Ink/React CLI that consumes `@stripe/link-sdk`. Entry: `src/cli.tsx`.

## Commands

```bash
pnpm install                    # install dependencies
pnpm run build                  # build all packages (turbo)
pnpm run dev                    # watch mode
pnpm run test                   # run all tests
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
- `ISpendRequestResource` — CRUD + request-approval for spend requests

The SDK only accepts credentials. Device authorization, refresh-token
persistence, login state, and auth-specific errors live under
`packages/cli/src/auth/`.

### CLI Command Structure

Commands in `packages/cli/src/cli.tsx` (incur framework). Each has two output modes:
- **Interactive** (default): Ink/React components from `packages/cli/src/commands/`
- **JSON** (`--format json`): JSON to stdout, errors as JSON with `code` and `message` fields with exit code 1

Commands: `auth login|logout|status`, `spend-request create|update|retrieve|request-approval|cancel`, `payment-methods list`, `shipping-address list`, `mpp pay|decode`, `serve`.

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
- `create --request-approval` and `request-approval` both show an approval URL in interactive mode and poll until approved/denied/expired/failed/canceled. In JSON mode (`--format json`), they return immediately with an `_next.command` for `spend-request retrieve`.
- `retrieve --interval <seconds>` polls until approved/denied/expired/succeeded/failed/canceled, or until `requires_action` with a non-`auto_resume` resolution (`auto_resume` is polled through transparently). If `--timeout` is reached or `--max-attempts` is exhausted while the request is still non-terminal, it exits non-zero with `POLLING_TIMEOUT`.
- Both `create` and `retrieve` (including `--request-approval`/`request-approval` polling and `retrieve --interval` polling) can return `status: 'requires_action'` with `status_details.requires_action.next_action` (`type`, `display_message`, `action_url`, `resolution`). `resolution: 'auto_resume'` (currently only `next_action.type: 'three_d_secure'`) means polling continues transparently — the request resolves on its own. Any other resolution stops polling immediately; the caller must have the user complete the action, then create a new spend request.
- `cancel <id>` cancels a spend request. Can cancel from `created`, `pending_approval`, or `approved` states. Returns the spend request with `status: "canceled"`.
- `--approval-detail` — optional JSON object (MCP/agent) or JSON string (CLI) with approval details for delegated flows. Required fields: `approved_at` (unix timestamp int), `approval_method` (`click`|`programmatic`|`voice`), `app_name`, `external_user_id`. Optional: `ip_address`, `user_agent`, `device_type` (`mobile`|`web`), `agent_log_id`, `external_user_name`, `external_session_id`, `authentication_method` (`biometric_face`|`biometric_fingerprint`|`passkey`). Sent as `approval_details` in the API request body.
- `card` credentials include `billing_address` (name, line1, line2, city, state, postal_code, country) and `valid_until` (ISO date string — when the card expires/stops working)
- `--output-file <path>` on `retrieve` or `create` writes full card credentials to a local file (0600 permissions) and redacts card data in stdout. `--force` allows overwriting an existing file.
- `create` also accepts an undocumented `--expires-at <unix_seconds>` to override the default 12-hour spend request expiration (3 hours to 7 days in the future). It's deliberately excluded from `--schema`/`--llms-full` output and from README/SKILL.md: it's gated to an allow-list of OAuth clients server-side, and most callers get a 400 (`"expires_at is not supported for this client"`) if they try it — don't document or suggest it to general agents.

### mpp pay

- `mpp pay <url> --context <ctx> [-X <method>] [-d <body>] [-H <header>]... [--amount <cents>] [--payment-method-id <id>] [--test]` — handles the full MPP flow end-to-end: probes the URL for a 402 challenge, parses the `www-authenticate` header to extract network_id and amount, creates a spend request (credential_type: shared_payment_token), gets user approval, retrieves the SPT, and pays. Amount/currency are derived from the 402 challenge; `--amount` overrides. `--context` is required (min 100 chars) — describe the purchase and rationale. Default payment method is used unless `--payment-method-id` is specified.
- `mpp pay <url> --spend-request-id <id> [--method <method>] [--data <body>] [--header <header>]...` — backward-compat mode: uses a pre-approved spend request directly, skipping creation/approval.
- `--header` is repeatable and uses `"Name: Value"` format. `Content-Type: application/json` is auto-applied when `--data` is provided; user-provided headers take precedence. Merchant probes and paid retries send `User-Agent: link-cli/<version>` unless `-H User-Agent` overrides it. The same configured fetch is used for those merchant requests (so `LINK_HTTP_PROXY` applies too).
- The SPT is one-time-use — a failed payment requires running `mpp pay` again (creates a new spend request).
- Implemented in `packages/cli/src/commands/mpp/` — pay.tsx (logic), schema.ts (input/output schema), index.tsx (incur registration).

### demo command

- `demo [--only-card] [--only-spt]` — Interactive demo of both payment flows. Always uses `--test` mode (no real charges). Shows a menu to choose: virtual card flow, SPT/machine payment flow, or both. `--only-card` and `--only-spt` skip the menu. Requires a TTY (no JSON output mode).

### onboard command

- `onboard` — Guided setup: authenticates (skips if already logged in), checks payment methods (prompts to add one if missing, shows picker if multiple), shows app download QR code, then runs the full demo. Requires a TTY.

### serve command

- `serve [--port <n>] [--host <host>]` — HTTP server that exposes the CLI's MCP endpoint. Implemented in `packages/cli/src/commands/serve/index.ts`. The handler forwards to `rootCli.fetch()` (incur), but is a **privilege boundary**: `requireAuth` only proves the CLI *owner* is authenticated, not that the HTTP caller is authorized.

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
- **Commands using `useAsyncAction` hook** — sanitized automatically. The hook calls `sanitizeDeep()` on all returned data before it reaches components.
- **Commands with manual state management** (e.g. `create.tsx`, `retrieve.tsx`, `request-approval.tsx`, `mpp/pay.tsx`) — must call `sanitizeDeep()` on API responses before calling `setRequest()`/`setState()`.
- **Attacker-controlled data that does NOT flow through an SDK resource** — must be sanitized at its own parse boundary. `mpp pay` sanitizes the HTTP response in `readPayResult()` (`pay.tsx`); `mpp decode` sanitizes the parsed `WWW-Authenticate` challenge in `decodeStripeChallenge()` (`decode.ts`). These bypass the resource factory, so the return value of the parse/fetch helper is the chokepoint — sanitizing there covers both the interactive Ink render and the agent (toon/yaml/md) output at once.

JSON output mode (`--format json`) is **not** affected — `JSON.stringify` encodes escape sequences as Unicode literals.
## Environment Variables

| Variable | Effect |
|----------|--------|
| `LINK_AUTH_FILE` | Same as `--auth` — override the auth credential file path (flag takes precedence) |
| `LINK_ACCESS_TOKEN` | Use this access token directly, bypassing auth storage |
| `LINK_REFRESH_TOKEN` | Refresh token to use when `LINK_ACCESS_TOKEN` is expired |
| `LINK_NO_REFRESH` | When set, never auto-refresh the access token — error instead |
| `LINK_API_BASE_URL` | Override API base URL |
| `LINK_AUTH_BASE_URL` | Override auth base URL |
| `LINK_HTTP_PROXY` | Route all outbound HTTP (Link API and `mpp pay` merchant requests) through an HTTP proxy (requires `undici` installed) |
