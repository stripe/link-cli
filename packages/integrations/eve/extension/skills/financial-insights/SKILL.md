---
name: financial-insights
description: Reads a user's Link transactions, balances, and financial sources to answer questions about spending, available funds, connected accounts, and account activity. Use for balance checks, transaction history, spending summaries, and source capabilities.
license: MIT
metadata:
  author: stripe
  url: link.com/agents
---

# Financial insights

Use this skill for read-only questions about the user's Link financial data.
Call the extension's native tools with their discovered mount prefix, such as
`link__list_transactions`. Inputs and results are structured objects; use the
tool schemas for parameter names and constraints.

For purchases or payment credentials, load the mounted
`create-payment-credential` skill instead.

## Authentication and access

The application configures the wallet and authorization provider. If Eve asks
the user to connect Link, let that authorization finish before continuing.
Do not ask for tokens in chat. If access is denied or a tool reports missing
permissions, explain what data could not be retrieved and stop. Do not repeatedly
retry the same denied operation.

## Choose the right tools

Use the smallest set that answers the question.

| User asks about | Tool |
| --- | --- |
| Purchases, merchants, spend, income, deposits, recurring payments | `list_transactions` |
| Current balance, available funds, cash position | `list_balances` |
| Connected accounts, source details, data capabilities | `list_sources` |

For restaurant spending last month, retrieve transactions for that period.
For an account balance, retrieve balances. For connected accounts, retrieve
sources. Combine tools only when the question requires it, such as joining
source names to balances.

## Amounts and sources

Financial-data amounts are integers in the currency's smallest unit. Format
using the currency's ISO 4217 minor-unit exponent; do not always divide by 100.
For example, `152340` represents $1,523.40 USD.

Only transaction `amount` uses negative values for money leaving the account
and positive values for money entering. Interpret balance fields according
to their balance type. Keep currencies separate when aggregating.

A source is an account connected to Link. Use its `id` to join records exposing
`source_id`. Do not guess which account owns a transaction whose `source_id`
is null. Sources can describe banks, cards, and other account types.

## Transactions

Call `list_transactions` with the relevant filters, for example:

```json
{
  "start_date": "2025-01-01",
  "end_date": "2025-01-31",
  "category": "groceries",
  "origin": "external_connection",
  "sources": ["<source_id>"],
  "limit": 100
}
```

Choose dates and filters from the user's question; omit unnecessary fields.

| Input | Meaning |
| --- | --- |
| `start_date`, `end_date` | Inclusive dates in `YYYY-MM-DD` format |
| `category` | Category filter |
| `origin` | `link` or `external_connection` |
| `sources` | Array of source IDs |

Useful response fields:

| Field | Interpretation |
| --- | --- |
| `amount` | Negative for outflows; positive for inflows |
| `origin` | Link-native or from an external connection |
| `category` | May be null when unclassified |
| `status` | API-provided status; do not assume a closed set of values or interpret/filter an unfamiliar status without knowing its meaning |

Distinguish spending from credits, deposits, and refunds. Explain whether a
reported total is gross spending or net movement. Group by merchant, category,
source, currency, or period only when relevant. Label summaries based on a
limited window or partial pagination accordingly.

## Balances

Call `list_balances` with `{}` for an initial page, or filter by sources:

```json
{ "sources": ["<source_id>"], "limit": 100 }
```

| Field | Interpretation |
| --- | --- |
| `type` | `cash` or `credit`; determines which sub-object is present |
| `current` | Balance before pending transactions; not necessarily available funds |
| `cash.available` | Currency-to-amount mapping for available cash, accounting for pending activity |
| `credit.used` | Currency-to-amount mapping for credit used |
| `as_of` | Last update time; the data may be stale |

Use `current` for a general balance question and `cash.available` when the user
asks about available cash. Do not present credit used as available funds.
Preserve currencies, summarize by source, and mention relevant freshness limits.

## Sources

Call `list_sources` with `{}` or pagination arguments.

| Field | Meaning |
| --- | --- |
| `id` | Source identifier used by balances and transactions |
| `name`, `type` | Display name and account type |
| `capabilities` | Data capabilities with status values, such as `balances.status` |
| `external_connection.status` | Connection status at the external institution |
| `granted_actions` | Actions the user has granted for this source |

Use capabilities and granted actions to understand what data is accessible.
Summarize institution, account type, and connection status when relevant. Avoid
exposing full account numbers, tokens, or unnecessary identifiers.

## Pagination

All three tools accept:

| Input | Meaning |
| --- | --- |
| `limit` | Results per page, from 1 to 100 |
| `starting_after` | Cursor for the next page |
| `ending_before` | Cursor for reverse navigation |

Responses contain `data` and may contain `has_more`. When `has_more` is true,
derive `starting_after` from the last returned item:

| Tool | Cursor field |
| --- | --- |
| `list_transactions` | `id` |
| `list_balances` | `source_id` |
| `list_sources` | `id` |

For example, continue a transaction query with the same filters and
`starting_after: "<last_transaction_id>"`. Change only the cursor across pages.
Stop when `has_more` is false or absent, or when the user's non-exhaustive lookup
is satisfied. If more results are reported but the page is empty or lacks a
usable cursor, stop and explain that pagination could not continue.

Fully paginate when a complete bounded result is needed, such as a total for
a specified month. Do not present a partial page's sum as the complete total.

## Answer the question

State the answer first, followed by the relevant period and source. Mention
limitations such as missing categories, pending activity, stale balances,
partial results, or inaccessible accounts. Summarize rather than dumping raw
records or object IDs.

If the tools return no matching data, say that no data was available for the
requested filters and access. That does not prove no activity occurred or that
an inaccessible balance is zero. Report uncertain derived insights as uncertain.

This skill does not move money, initiate payments, or modify sources. Retrieve
only relevant financial data and never expose payment credentials.
