---
name: financial-insights
description: Reads a user's Link transactions, balances, financial sources, and precomputed insights to answer questions about spending, available funds, connected accounts, and account activity. Use for balance checks, transaction history, spending summaries, shopping patterns, and source capabilities.
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
| Precomputed signals, such as top brands per shopping category | `list_available_insight_types`, then `list_insights` |

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

## Insights

Insights are signals Link computes ahead of time, such as
`top_brand_by_transaction_count_per_category_t180d` (top brands per shopping
category over the last 180 days, by transaction count). New types can appear
without an extension release.

1. If you do not already know the applicable insight ID or its access
   requirement, call `list_available_insight_types` with `{}`. Each type has an
   `id`, a `description`, and, when the current grant needs more access, an
   `authorization_remediation` with the `scope` or `authorization_details`
   required.
2. Call `list_insights` with only the IDs the task needs, for example
   `{ "insights": ["top_brand_by_transaction_count_per_category_t180d"] }`.
   Omit `insights` only when the user asks for an overview of all insights.

Both tools accept `limit` (1 to 100, default 10) and `starting_after` (the last
returned insight `id`); they do not accept `ending_before`.

Handle each result by `status` and `error_code`:

| Result | Meaning | What to do |
| --- | --- | --- |
| `ready` | Computed; `data` holds `{ label, value }` entries | Use it and mention `as_of` when freshness matters |
| `pending` | Not computed yet | Treat as unavailable for this answer. Do not call again in a loop |
| `no_data` with `error_code: missing_permissions` | The grant lacks access | Explain the access listed in `authorization_remediation` (below) |
| `no_data` with `error_code: internal_error` | Link could not compute it | Say the insight is temporarily unavailable |
| `no_data` with no `error_code` | No qualifying activity in the authorized data | Say no qualifying activity was found for the access granted |

Never report missing permissions, pending, or failed results as zero activity.

For `missing_permissions`, tell the user which access is missing (for example,
transaction access for a Link payment detail) and why. Access comes from the
application's authorization provider, never from chat. If Eve presents an
authorization challenge, let the user complete it, then call `list_insights`
once more for the same IDs. If authorization is declined or access is still
missing, continue without the insight and say so. Request nothing beyond the
supplied remediation.

Values are tagged by `type`. `number_of_items` values carry
`number_of_items.label`, naming what was counted (such as the brand), and
`number_of_items.count`; the entry `label` names the category, for example
"Top brand from Clothing and accessories shopping category" with `J.crew` and
a count of 10. The `number_of_items.label` may be absent. For an unfamiliar `type`, describe only what its
fields make clear, or omit it.

Insights describe observed history. Explicit user instructions and stated
preferences always override them. Describe a pattern as observed, for example
"your recent transactions point to J.crew for clothing", not as a
preference the user declared. Results cover only authorized sources; mention
that coverage may be incomplete.

## Pagination

`list_transactions`, `list_balances`, and `list_sources` accept:

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
Mention `as_of` when stale data could change the answer.

This skill does not move money, initiate payments, or modify sources. Retrieve
only relevant financial data and never expose payment credentials.
