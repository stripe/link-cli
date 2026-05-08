# Link CLI

Link CLI lets agents get secure, one-time-use payment credentials from a Link wallet to complete purchases on your behalf — without storing your real card details.

The CLI can produce one of two credential types:

- A virtual card (PAN) for use with a standard web checkout form. The issued card works anywhere, and is not restricted to Link-enabled sellers or sellers that use Stripe.
- A [Shared Payment Token](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens) (SPT) when the seller accepts programmatic payments through [Machine Payment Protocols](https://mpp.dev) (MPP)

For now, this is only available to US Link accounts.

## Installation

```bash
npm i -g @stripe/link-cli
```

Or run directly with `npx`:

```bash
npx @stripe/link-cli
```

### Use with agents

Install the skill:

```bash
npx skills add stripe/link-cli
```

By default when called from an agent (non-TTY), all commands use `toon` output — a compact, LLM-friendly text format. All commands accept `--format [format]` for structured output. Other formats: `json`, `yaml`, `md`, `jsonl`.

List available commands:

```bash
link-cli --llms-full
```

Get a command's full schema with `--schema`. Example:

```bash
link-cli spend-request create --schema
```

#### MCP Server

Link CLI can run as a local MCP server. Add the following to your MCP client config (`.mcp.json`, etc.)

```json
{
  "mcpServers": {
    "link": {
      "command": "npx",
      "args": ["@stripe/link-cli", "--mcp"]
    }
  }
}
```

## Quickstart

Run a guided onboarding and demo flow:

```bash
link-cli onboard
```

### Login

The `link-cli` requires a Link account. You can log in to your existing one or [register online](https://app.link.com).

```bash
link-cli auth login
```

You receive a verification URL and a short phrase. Visit the URL, log in to your Link account, and enter the phrase to approve the connection.

### List payment methods

```bash
link-cli payment-methods list
```

Returns the cards and bank accounts saved to your Link account. Use the `id` field as `payment_method_id` in the next step. If you have no payment methods, [add new ones in Link](https://app.link.com/wallet).

### List shipping addresses

```bash
link-cli shipping-address list
```

Returns the shipping addresses saved to your Link account. The response preserves nullable `nickname`, `address`, and address fields exactly as returned by the API.

### Create a spend request

Create a spend request with a payment method, merchant details, line items, and amounts:

```bash
link-cli spend-request create \
  --payment-method-id csmrpd_xxx \
  --merchant-name "Stripe Press" \
  --merchant-url "https://press.stripe.com" \
  --context "Purchasing 'Working in Public' from press.stripe.com. The user initiated this purchase through the shopping assistant." \
  --amount 3500 \
  --line-item "name:Working in Public,unit_amount:3500,quantity:1" \
  --total "type:total,display_text:Total,amount:3500" \
  --request-approval
```

The `--request-approval` flag triggers a push notification to the user for approval, then polls until the request is approved or denied.

Easily approve requests with the [Link app](https://link.com/download).

#### Line items and totals

`--line-item` and `--total` use repeatable `key:value` format.

**`--line-item` keys:** `name` (required), `quantity`, `unit_amount`, `description`, `sku`, `url`, `image_url`, `product_url`

```bash
--line-item "name:Running Shoes,unit_amount:12000,quantity:1,description:Trail runners"
```

**`--total` keys:** `type` (required; one of: `subtotal`, `tax`, `total`), `display_text` (required), `amount` (required)

```bash
--total "type:subtotal,display_text:Subtotal,amount:12000" \
--total "type:total,display_text:Total,amount:12000"
```

#### Credential types

By default, a spend request provisions a virtual card. For merchants that support the [Machine Payments Protocol](https://mpp.dev) (HTTP 402) and the Stripe payment method, instead pass `--credential-type "shared_payment_token"`. 

### Execute payment

The approved spend request includes a `card` object with `number`, `cvc`, `exp_month`, `exp_year`, `billing_address`, and `valid_until`. Enter these into the merchant's checkout form. 

```bash
link-cli spend-request retrieve lsrq_001
```
By default, retrieving a spend request doesn't include card details. Pass `--include card` to see unmasked card details.

To avoid leaking card credentials into agent transcripts or logs, use `--output-file` to write the full card to a secure local file while stdout shows only redacted data (brand, last4, expiry):

```bash
link-cli spend-request retrieve lsrq_001 --include card --output-file /tmp/link-card.json --format json
```

The file is created with `0600` permissions. If the file already exists, the command fails unless `--force` is passed. When `--output-file` is set, the JSON output replaces the `card` object with redacted fields and adds a `card_output_file` path.

For agent polling, pass `--interval` and optionally `--max-attempts`:

```bash
link-cli spend-request retrieve lsrq_001 --interval 2 --max-attempts 150
```

Polling exits successfully only after the request reaches a terminal status such as `approved`, `denied`, `expired`, or `canceled`. If polling reaches `--timeout` or exhausts `--max-attempts` while the request is still non-terminal, the command exits non-zero with `code: "POLLING_TIMEOUT"` so callers do not treat a still-pending request as complete.

If the merchant supports MPP, use `link-cli mpp pay` instead:

```bash
link-cli mpp pay https://climate.stripe.dev/api/contribute \
  --spend-request-id lsrq_001 \
  --method POST \
  --data '{"amount":100}'
```

## Advanced

### Authentication

```bash
link-cli auth login --client-name "Claude Code"   # identify the connecting agent
link-cli auth status                               # check auth status
link-cli auth logout                               # disconnect
```

When you provide `--client-name`, the Link app displays it when you approve the connection — for example, `Claude Code on my-macbook` instead of `link-cli on my-macbook`.

`auth status` includes an `update` field when a newer version is available:

```json
{
  "authenticated": true,
  "update": {
    "current_version": "0.1.2",
    "latest_version": "0.2.0",
    "update_command": "npm install -g @stripe/link-cli"
  }
}
```

Set `NO_UPDATE_NOTIFIER=1` to suppress update checks (for example, in CI).

All commands accept `--auth <path>` to store auth credentials in a specific file instead of the default location. `auth login` writes to this file; all other commands read from it. Useful for running multiple sessions with separate identities.

### Spend request lifecycle

A spend request moves through: **create** → **request approval** → **approved** (with credentials).

**Required fields for create:** `payment_method_id`, `merchant_name`, `merchant_url`, `context`, `amount`

**Constraints:** `context` must be at least 100 characters; `amount` must not exceed 50000 (cents); `currency` must be a 3-letter ISO code.
**Test mode:** Pass `--test` to create testmode credentials (uses test card `4242424242424242`), useful for development and integration testing without real payment methods.

```bash
# Update before approval
link-cli spend-request update lsrq_001 \
  --merchant-url https://press.stripe.com/working-in-public

# Request approval separately (alternative to create --request-approval)
link-cli spend-request request-approval lsrq_001

# Retrieve at any time (includes card credentials after approval)
link-cli spend-request retrieve lsrq_001

# Cancel a spend request (from created, pending_approval, or approved state)
link-cli spend-request cancel lsrq_001
```

### MPP

Use `mpp pay` to complete purchases on merchants that use the [Machine Payments Protocol](https://mpp.dev). The spend request must use `credential_type: "shared_payment_token"` and you must approve it before paying. The SPT is one-time-use — if payment fails, create a new spend request.

```bash
link-cli mpp pay https://climate.stripe.dev/api/contribute \
  --spend-request-id lsrq_001 \
  --method POST \
  --data '{"amount":100}' \
  --header "X-Custom: value"
```

Use `mpp decode` to validate a raw `WWW-Authenticate` header and extract the `network_id` needed for `shared_payment_token` spend requests:

```bash
link-cli mpp decode \
  --challenge 'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge", request="..."'
```

### Environment variables

| Variable | Effect |
|----------|--------|
| `LINK_AUTH_FILE` | Same as `--auth` — override the auth credential file path (flag takes precedence) |
| `LINK_API_BASE_URL` | Override the API base URL |
| `LINK_AUTH_BASE_URL` | Override the auth base URL |
| `LINK_HTTP_PROXY` | Route all requests through an HTTP proxy (requires `undici`) |

## Onboard

Run the guided setup flow — authenticates, checks payment methods, shows the app download QR, and runs both demo flows:

```bash
link-cli onboard
```

## Demo

Run an interactive demo of both Link payment flows (always uses test mode — no real charges):

```bash
link-cli demo              # shows menu to choose flow
link-cli demo --only-card  # virtual card flow only
link-cli demo --only-spt   # machine payment (SPT) flow only
```

## Development

```bash
pnpm install
pnpm run build
pnpm run link-cli --help
```

Watch mode:

```bash
pnpm run dev
```

Run tests:

```bash
pnpm run test
```

Type-check and lint:

```bash
pnpm run typecheck
pnpm biome check .
```

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing. Only `@stripe/link-cli` is published to npm — internal packages (`@stripe/link-sdk`, `@stripe/link-typescript-config`) are ignored by changesets.

### Add a changeset

When you make a user-facing change, add a changeset before merging:

```bash
pnpm changeset
```

Follow the prompts to select the package (`@stripe/link-cli`) and the semver bump type (patch, minor, or major). This creates a markdown file in `.changeset/` describing the change.

### Version

Once changesets have accumulated on `main`, create a version PR:

```bash
pnpm changeset version
```

This consumes all pending changesets, bumps the version in `packages/cli/package.json`, and updates `CHANGELOG.md`.

### Publish

After the version PR is merged:

```bash
pnpm run build
pnpm changeset publish
```

This publishes `@stripe/link-cli` to npm. CI also runs `pnpm --filter @stripe/link-cli publish --dry-run --no-git-checks` on every push to `main` to verify the package is publishable.
