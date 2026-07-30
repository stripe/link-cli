---
version: 0.9.0
name: financial-insights
description: |
  Reads a user's Link financial data — transactions, balances, and wallet sources — so agents can answer questions about spending, account balances, and available source capabilities. Use when the user says "show my transactions", "what did I spend on X", "what's my balance", "list my recent purchases", or asks any read-only question about their Link activity feed, balances, or wallet sources.
allowed-tools:
 - Bash(link-cli:*)
 - Bash(npx:*)
 - Bash(npm:*)
license: Complete terms in LICENSE
metadata:
  author: stripe
  url: link.com/agents
  openclaw:
    emoji: "📊"
    homepage: https://link.com/agents
    requires:
      bins:
        - link-cli
    install:
      - kind: node
        package: "@stripe/link-cli"
        bins: [link-cli]
user-invocable: true
---

# Financial Insights

Read a user's Link financial data with three commands:

- `link-cli transactions list` — the user's transaction activity feed (purchases, transfers, and other movements).
- `link-cli balances list` — current balances for the user's connected sources.
- `link-cli sources list` — the user's Link wallet sources and their capabilities.

All are read-only. They do not move money or expose payment credentials. To make a purchase, use the `create-payment-credential` skill instead.

## Which command to use

| The user asks about | Command |
|---------------------|---------|
| Spending, purchases, recent activity, a specific transaction, amounts, dates | `transactions list` |
| Current balance, how much money is available, cash vs credit breakdown | `balances list` |
| Wallet sources, capabilities, source IDs, external connection status | `sources list` |

If the user asks "where did this charge come from", start with `transactions list` and filter by date, amount, description, or category.

If the user asks "how much do I have", use `balances list`. You can filter by source if you already know the source ID from `sources list`.

## Authentication

All three commands use the normal Link OAuth session from `link-cli auth login`. They also work when the user supplies `LINK_ACCESS_TOKEN` (and optionally `LINK_REFRESH_TOKEN`).

To retrieve financial data, request these source actions when authenticating:

```bash
link-cli auth login \
  --source-actions read_source_details \
  --source-actions read_balances \
  --source-actions read_external_transactions \
  --source-actions read_link_transactions \
```

This is not the CLI default. If you do not pass `--scope`, the CLI requests `userinfo:read payment_methods.agentic`.

The source actions are sent as `authorization_details`.

## Reading output

Pass `--format json` for structured output an agent can parse; the default `toon` format is for humans.

```bash
# Recent transactions as JSON
link-cli transactions list --format json

# Balances as JSON
link-cli balances list --format json

# Sources as JSON
link-cli sources list --format json
```

`transactions list` returns a paginated response object. Use the cursor fields to page:

```bash
# First 50 transactions
link-cli transactions list --limit 50 --format json

# Next page: pass the last transaction's ID
link-cli transactions list --limit 50 --starting-after <id> --format json
```

Transactions are normalized under the `data` field:

```json
{
  "data": [
    {
      "id": "lbctxn_1TgVIgD1x6WbyBUHVcFXmvHu",
      "source_id": null,
      "amount": -979,
      "currency": "usd",
      "created_date": "2026-06-08",
      "description": "Chase",
      "category": "credit_card_payment",
      "status": "succeeded"
    }
  ],
  "has_more": true
}
```

`source_id` and `category` may be `null`.

`balances list` returns a paginated response object with balance entries under `data`:

```json
{
  "data": [
    {
      "source_id": "csmrpd_123",
      "type": "cash",
      "current": 152340,
      "currency": "usd",
      "as_of": "2026-07-29T00:00:00Z"
    }
  ],
  "has_more": false
}
```

Each balance has:
- `source_id` — which source this balance belongs to
- `type` — `cash` or `credit`
- `current` — balance amount in cents
- `currency` — ISO currency code
- `as_of` — when the balance was last refreshed

`sources list` returns a paginated response object with loose source objects under `data`:

```json
{
  "data": [
    {
      "id": "csmrpd_123",
      "name": "Checking 1234",
      "type": "bank_account",
      "capabilities": {
        "transactions": { "status": "eligible" },
        "balances": { "status": "eligible" }
      },
      "external_connection": { "status": "active" },
      "granted_scopes": ["source_details:read", "transactions:read"]
    }
  ],
  "has_more": false
}
```

## Filtering

### transactions list

| Flag | Effect |
|------|--------|
| `--limit <1-100>` | Max number of transactions to return |
| `--starting-after <id>` / `--ending-before <id>` | Cursor pagination |
| `--start-date <yyyy-mm-dd>` / `--end-date <yyyy-mm-dd>` | Time window (inclusive) |
| `--category <category>` | Filter by category |

### balances list

| Flag | Effect |
|------|--------|
| `--source <id>` | Filter by source ID. Repeat to include multiple sources. |
| `--limit <1-100>` | Max number of balances to return |
| `--starting-after <id>` / `--ending-before <id>` | Cursor pagination |

### sources list

| Flag | Effect |
|------|--------|
| `--limit <1-100>` | Max number of sources to return |
| `--starting-after <id>` / `--ending-before <id>` | Cursor pagination |

There is no generic arbitrary query-param passthrough today. Use the explicit pagination and filter flags.

Examples:

```bash
# Authenticate once with source actions, then list transactions
link-cli auth login \
  --source-actions read_source_details \
  --source-actions read_balances \
  --source-actions read_external_transactions \
  --source-actions read_link_transactions
link-cli transactions list --format json

# Transactions in a date window
link-cli transactions list \
  --category credit_card_payment \
  --start-date 2026-05-01 \
  --end-date 2026-05-31 \
  --format json

# Balances for a specific source
link-cli balances list --source csmrpd_123 --format json

# Balances for multiple sources
link-cli balances list --source csmrpd_123 --source csmrpd_456 --format json

# All sources
link-cli sources list --format json
```

## Reference

- Get the exact schema: `link-cli transactions list --schema`, `link-cli balances list --schema`, and `link-cli sources list --schema`.
- List all commands: `link-cli --llms-full`.
- Link app (account management): https://app.link.com
- Link support: https://support.link.com/topics/about-link