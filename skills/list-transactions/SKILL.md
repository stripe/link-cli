---
version: 0.8.2
name: list-transactions
description: |
  Lists authenticated Link transaction history from Link and external accounts using `link-cli transactions list`. Use when the user asks to view, search, filter, page through, export, summarize, or inspect Link transactions, bank/card activity, transaction history, spending activity, merchant charges, dates, amounts, or statuses.
allowed-tools:
 - Bash(link-cli:*)
 - Bash(npx:*)
 - Bash(npm:*)
license: Complete terms in LICENSE
metadata:
  author: stripe
  url: link.com/agents
  openclaw:
    emoji: "🧾"
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

# List Transactions

Use Link CLI to retrieve a user's transaction history across Link and connected external accounts.

## Installing

Install with `npm install -g @stripe/link-cli`. Or run directly with `npx @stripe/link-cli`.

## Authentication

Check auth before listing transactions:

```bash
link-cli auth status
```

If the user is not authenticated, run:

```bash
link-cli auth login --client-name "<your-agent-name>"
```

Run the returned `_next.command` until authentication completes. Do not start a new login flow when `auth status` shows the user is already authenticated.

The command can also use `LINK_ACCESS_TOKEN` directly when the environment provides one.

## Command

Prefer structured output for agent workflows:

```bash
link-cli transactions list --json
```

For human terminal review without explicit JSON/format flags, the CLI renders an interactive table with columns for date, amount, status, and description.

## Filters

Pass only filters the user requested or that are needed to satisfy the task:

```bash
link-cli transactions list \
  --limit 25 \
  --start-date 2026-04-01 \
  --end-date 2026-04-30 \
  --origin link \
  --source csmrpd_123 \
  --json
```

Available options:

| Option | Meaning |
|---|---|
| `--limit <n>` | Maximum number of transactions to return. Must be 1-100. |
| `--start-date <YYYY-MM-DD>` | Include transactions on or after this date. |
| `--end-date <YYYY-MM-DD>` | Include transactions on or before this date. |
| `--origin <origin>` | Include only transactions from `link` or `external_connection`. |
| `--source <source_id>` | Include only transactions from this source ID. Repeat to include multiple sources. |
| `--starting-after <transaction_id>` | Cursor for the next page after a transaction ID. |
| `--ending-before <transaction_id>` | Cursor for the previous page before a transaction ID. |

Dates must be in `YYYY-MM-DD` format.

## Pagination

The JSON response is a page:

```json
{
  "data": [
    {
      "id": "lbctxn_001",
      "source_id": null,
      "amount": 1234,
      "currency": "usd",
      "created_date": "2026-06-08",
      "description": "Example merchant",
      "origin": "external_connection",
      "status": "succeeded"
    }
  ],
  "has_more": true
}
```

When `has_more` is true, get the next page with the last transaction ID from `data`:

```bash
link-cli transactions list --starting-after <last_transaction_id> --json
```

Keep the user's original filters when paging. Example:

```bash
link-cli transactions list \
  --start-date 2026-04-01 \
  --end-date 2026-04-30 \
  --origin link \
  --source csmrpd_123 \
  --starting-after lbctxn_001 \
  --json
```

## Amounts

`amount` is returned in the minor currency unit. For `usd`, `1234` means `$12.34`. Preserve the `currency` field when summarizing or comparing transactions.

## Troubleshooting

- `NOT_AUTHENTICATED`: run `link-cli auth login --client-name "<your-agent-name>"`, or use `LINK_ACCESS_TOKEN` if one is already available.
- Invalid date: convert the date to `YYYY-MM-DD`.
- Too many results: use `--limit`, date filters, source/origin filters, and pagination.
- Debug API behavior with the global `--verbose` flag, but do not share authorization headers.
