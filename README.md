# Link CLI

Link CLI lets agents get secure, one-time-use payment credentials from a Link wallet — so they can complete purchases on your behalf without ever storing your real card details.

## Installation

```bash
npm i -g @stripe/link-cli
```

Or run directly with `npx`:

```bash
npx @stripe/link-cli
```

You can install the skill via `link-cli skill --install`.

## Quickstart

### Login

The `link-cli` requires a Link account. You can login to your existing one or [register online](https://app.link.com).

```bash
link-cli auth login
```

You'll receive a verification URL and a short passphrase. Visit the URL, log in to your Link account, and enter the passphrase to approve the connection.

### List payment methods

```bash
link-cli payment-methods list
```

Returns the cards and bank accounts saved to your Link account. Use the `id` field as `payment_method_id` in the next step. If you have no payment methods, you can [add new ones in Link](https://app.link.com/wallet).

### Create a spend request

To request a secure, one-time payment credential from your Link wallet, you create a spend request. You specify a payment method in your account, as well as some merchant details, line items, and amounts.

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

The `--request-approval` flag triggers a push notification (or email) to the user for approval, then polls until the request is approved or denied.

Users can easily approve requests with the [Link app](https://link.com/download).

#### Credential types

By default, a spend request provisions a virtual card. For merchants that support the [Machine Payments Protocol](https://mpp.dev) (HTTP 402) and the Stripe payment method, you can instead include `--credential-type "shared_payment_token"`. 

### Execute payment

The approved spend request includes a `card` object with `number`, `cvc`, `exp_month`, `exp_year`, `billing_address`, and `valid_until`. Enter these into the merchant's checkout form. 

```bash
link-cli spend-request retrieve lsrq_001 --output-json
```
By default, retrieving a spend request will not include card details. Use the `--include=card` to see unmasked card details.

If the merchant supports MPP, use `link-cli mpp pay` instead:

```bash
link-cli mpp pay https://climate.stripe.dev/api/contribute \
  --spend-request-id lsrq_001 \
  --method POST \
  --data '{"amount":100}' \
  --output-json
```

## Advanced

### Authentication

```bash
link-cli auth login --client-name "Claude Code" --output-json    # identify the connecting agent
link-cli auth status --output-json                               # check auth status
link-cli auth logout --output-json                               # disconnect
```

When `--client-name` is provided, the name is shown in the Link app when the user approves the connection — e.g. `Claude Code on my-macbook` instead of `link-cli on my-macbook`.

### Spend request lifecycle

A spend request moves through: **create** → **request approval** → **approved** (with credentials).

**Required fields for create:** `payment_method_id`, `merchant_name`, `merchant_url`, `context`, `amount`

**Constraints:** `context` must be at least 100 characters; `amount` must not exceed 50000 (cents); `currency` must be a 3-letter ISO code.
**Test mode:** Pass `--test` to create testmode credentials (uses test card `4242424242424242`). Useful for development and integration testing without using real payment methods.

```bash
# Update before approval
link-cli spend-request update lsrq_001 \
  --merchant-url https://press.stripe.com/working-in-public \
  --output-json

# Request approval separately (alternative to create --request-approval)
link-cli spend-request request-approval lsrq_001 --output-json

# Retrieve at any time (includes card credentials once approved)
link-cli spend-request retrieve lsrq_001 --output-json
```

### JSON

All commands accept `--json` for structured input (mutually exclusive with flags):

```bash
link-cli spend-request create --json '{
  "payment_method_id": "csmrpd_xxx",
  "merchant_name": "Stripe Press",
  "merchant_url": "https://press.stripe.com/working-in-public",
  "context": "Purchasing '\''Working in Public'\'' from press.stripe.com. The user initiated this purchase through the shopping assistant.",
  "amount": 3500,
  "line_items": [{ "name": "Working in Public", "unit_amount": 3500, "quantity": 1 }],
  "totals": [{ "type": "total", "display_text": "Total", "amount": 3500 }]
}' --output-json
```

All commands also accept `--output-json` for structured JSON output. Errors are returned as JSON to stderr with exit code 1.

### MPP

Use `mpp pay` to complete purchases on merchants that use the [Machine Payments Protocol](https://mpp.dev). The spend request must use `credential_type: "shared_payment_token"` and be approved. The SPT is one-time-use — if payment fails, create a new spend request.

```bash
link-cli mpp pay https://climate.stripe.dev/api/contribute \
  --spend-request-id lsrq_001 \
  --method POST \
  --data '{"amount":100}' \
  --header "X-Custom: value" \
  --output-json
```

Use `mpp decode` to validate a raw `WWW-Authenticate` header and extract the `network_id` needed for `shared_payment_token` spend requests:

```bash
link-cli mpp decode \
  --challenge 'Payment id="ch_001", realm="merchant.example", method="stripe", intent="charge", request="..."' \
  --output-json
```

### Environment variables

| Variable | Effect |
|----------|--------|
| `LINK_API_BASE_URL` | Override the API base URL |
| `LINK_AUTH_BASE_URL` | Override the auth base URL |
| `LINK_HTTP_PROXY` | Route all requests through an HTTP proxy (requires `undici`) |

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
