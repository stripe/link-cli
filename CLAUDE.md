# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Link CLI — lets agents get secure, one-time-use payment credentials from a Link wallet. pnpm + Turborepo monorepo:

- **`@stripe/link-sdk`** (`packages/sdk`): Repository interfaces, API implementations, types, and local storage. Entry: `src/index.ts`.
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
- `IAuthResource` — device auth flow (initiate, poll, refresh)
- `ISpendRequestResource` — CRUD + request-approval for spend requests

### CLI Command Structure

Commands in `packages/cli/src/cli.tsx` (incur framework). Each has two output modes:
- **Interactive** (default): Ink/React components from `packages/cli/src/commands/`
- **JSON** (`--format json`): JSON to stdout, errors as JSON with `code` and `message` fields with exit code 1

Commands: `auth login|logout|status`, `spend-request create|update|retrieve|request-approval`, `payment-methods list`, `mpp pay|decode`.

The CLI also runs as an MCP server (`--mcp`) and serves skill files via `skills` subcommand, both provided by incur.

**When changing commands, flags, or schema descriptions, always update all three together:** `README.md`, `skills/create-payment-credential/SKILL.md`, the schema description strings in the relevant `schema.ts` file, and `CLAUDE.md`. These can easily drift apart.

Input is passed via flags. Define options in the command's zod schema — incur registers CLI flags automatically from the schema.

### auth login

- `auth login --client-name <name>` — optional flag to identify the agent or app; shown in the user's Link app as `<name> on <hostname>`. Defined in `loginOptions` in `packages/cli/src/commands/auth/schema.ts`.

### spend-request command

CLI command is `spend-request` (user-facing). Implemented in `packages/cli/src/commands/spend-request/`. SDK interfaces: `ISpendRequestResource`, `CreateSpendRequestParams`, `UpdateSpendRequestParams`. API endpoint: `/spend_requests`.

Key input field notes:
- CLI input uses `payment_method_id`; mapped to `payment_details` when calling the SDK
- `context` requires min 100 characters; `amount` is in cents with max 50000
- `--test` flag creates testmode credentials (real testmode SPT from test card data) instead of livemode ones
- `create --request-approval` and `request-approval` both show an approval URL in interactive mode and poll until approved/denied/expired/failed. In JSON mode (`--format json`), they block silently and return the final `SpendRequest` when complete.
- `card` credentials include `billing_address` (name, line1, line2, city, state, postal_code, country) and `valid_until` (unix timestamp — when the card expires/stops working)

### mpp pay

- `mpp pay <url> --spend-request-id <id> [--method <method>] [--data <body>] [--header <header>]...` — completes the 402 flow: retrieves the spend request with `include: ['shared_payment_token']`, probes the URL, parses the `www-authenticate` stripe challenge, builds the `Authorization: Payment` credential, and retries. `--header` is repeatable and uses `"Name: Value"` format. `Content-Type: application/json` is auto-applied when `--data` is provided; user-provided headers take precedence.
- Requires an approved spend request with `credential_type: "shared_payment_token"`. The SPT is one-time-use — a failed payment requires a new spend request.
- Implemented in `packages/cli/src/commands/mpp/` — pay.tsx (logic), schema.ts (input/output schema), index.tsx (incur registration).


## Code Conventions

- **ESM everywhere** — `"type": "module"` in all package.json files
- **Biome** — 2-space indent, single quotes, organized imports
- **tsup** — ESM output, Node 18 target
- **Vitest** — test files in `__tests__/` directories adjacent to source
- **TypeScript strict mode** — `tsconfig.base.json` at root
- **React 18 + Ink 5** for interactive rendering
- **`conf`** for local auth token storage

## Environment Variables

| Variable | Effect |
|----------|--------|
| `LINK_API_BASE_URL` | Override API base URL |
| `LINK_AUTH_BASE_URL` | Override auth base URL |
| `LINK_HTTP_PROXY` | Route all SDK requests through an HTTP proxy (requires `undici` installed) |
