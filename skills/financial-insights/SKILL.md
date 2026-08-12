---
version: 0.11.0
name: financial-insights
description: |
  Reads a user's Link financial data — transactions, balances, and wallet sources — so agents can answer questions about spending and available source capabilities. Use when the user says "check my balance", "how much did I spend", "show my transactions", "what accounts are connected", "summarize my spending", "recent purchases", or asks about their financial activity, account balances, or linked sources.
allowed-tools:
 - Bash(link-cli:*)
 - Bash(npx --yes @stripe/link-cli:*)
 - Bash(npx @stripe/link-cli:*)
 - Bash(npm install -g @stripe/link-cli:*)
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

# Financial insights

Use this skill to answer questions about a user’s Link-connected financial data, including:

- Recent transactions
- Spending patterns
- Account balances
- Linked wallet sources
- Basic summaries derived from the user’s financial data

All commands are read-only. They do not move money, initiate payments, modify accounts, or expose payment credentials.

## Safety and privacy

Do not retrieve financial data until the user is authenticated with the required source actions.

Only retrieve the data needed to answer the user’s request. Do not run every list command by default.

Do not expose sensitive identifiers, access tokens, credentials, or payment instrument details. Summarize financial information at the level needed to answer the user’s question.

If the user asks for an action that would move money, reference `skills/create-payment-credential/SKILL.md` instead.

## Authentication

Before retrieving financial data, check whether the user is authenticated and whether the current session has the required source actions.

```bash
link-cli auth status --format json
```

When present, inspect `authorization_details` in the response for entries with `type: "source"` and the required actions. The field may be absent when the token endpoint did not return authorization details or when authentication comes from `LINK_ACCESS_TOKEN`; in that case, run only the minimum data command needed and handle a permission error as described below.

If the user is not authenticated, start a login that requests only the source actions needed for the requested data. If the user is already authenticated but one or more required source actions are missing, use `auth upgrade` instead of `auth login`. `auth upgrade` preserves the current session while the user approves the additional access and replaces it only after approval succeeds.

Use the minimum required source actions:

- Transactions processed through Link: `read_link_transactions`
- Transactions imported from bank connections: `read_external_transactions`
- Account balances: `read_balances`
- Data source details and descriptions: `read_source_details`

If the user asks a question that requires multiple data types, request all relevant actions together.

Example for a new login that needs all financial data types:

```bash
link-cli auth login \
  --client-name "<your-agent-name>" \
  --source-actions read_link_transactions \
  --source-actions read_balances \
  --source-actions read_external_transactions \
  --source-actions read_source_details \
  --format json
```

Example for adding balance access to an existing session:

```bash
link-cli auth upgrade \
  --client-name "<your-agent-name>" \
  --source-actions read_balances \
  --format json
```

Replace `<your-agent-name>` with a clear name for the agent or application. Present the returned `verification_url` to the user, then follow the response's `_next` instruction or poll with:

```bash
link-cli auth status --interval 5 --max-attempts 60 --format json
```

Do not proceed until authentication or the access upgrade succeeds. If the approval expires, is denied, or times out, report that outcome instead of repeatedly starting new authorization flows.

## Choosing the right command

Use the smallest command set that answers the user’s question.

| User asks about | Command |
|---|---|
| Recent purchases, merchants, spend, transaction history, income, deposits, subscriptions | `link-cli transactions list` |
| Current available balance, account balance, cash position | `link-cli balances list` |
| Connected accounts, cards, banks, wallet sources, source metadata | `link-cli sources list` |

Examples:

- “How much did I spend on restaurants last month?” → Use transactions only.
- “What is my current checking account balance?” → Use balances only.
- “Which accounts are connected?” → Use sources only.
- “Summarize my cash position and recent spending.” → Use balances and transactions.

## Output format

Use JSON for agent-readable structured output.

```bash
link-cli transactions list --format json
link-cli balances list --format json
link-cli sources list --format json
```

The default `toon` format is intended for humans. Prefer `--format json` whenever parsing, filtering, aggregating, or summarizing results.

All monetary amounts across all endpoints are integers in the currency's smallest unit (e.g. `152340` = $1,523.40 USD). Format amounts with a currency-aware formatter that uses the currency's ISO 4217 minor-unit exponent; do not assume every currency has two decimal places or always divide by 100.

Keep sign interpretation field-specific. Only `transactions.amount` uses negative for money leaving the account and positive for money entering it. Do not apply transaction sign semantics to balance fields; interpret `current`, `cash.available`, and `credit.used` according to the balance type.

## Sources (concept)

A **source** is a financial account connected to the user's Link wallet — a bank account, credit card, savings account, etc. Each source has a unique `id` (e.g. `csmrpd_abc123`) that other endpoints may expose as `source_id`:

- In `transactions list`, `source_id` indicates which account a transaction belongs to.
- In `balances list`, each balance entry includes a `source_id` identifying the account.
- In `sources list`, the full source metadata (name, institution, type, status) is returned.

Use a `source_id` to correlate data across commands — for example, to find transactions for a specific account or to match a balance to its source type. Do not assign transactions with a null `source_id` to a source by guessing from their description.

## Transactions

Use transactions to answer questions about spending, income, merchants, categories, recurring payments, deposits, or account activity.

```bash
link-cli transactions list --format json
```

Common options:

```bash
link-cli transactions list --format json --start-date 2025-01-01 --end-date 2025-01-31
link-cli transactions list --format json --category groceries
link-cli transactions list --format json --origin external_connection
link-cli transactions list --format json --source <source_id> --source <source_id>
```

| Flag | Description |
|---|---|
| `--start-date` | Only transactions on or after this date (YYYY-MM-DD). |
| `--end-date` | Only transactions on or before this date (YYYY-MM-DD). |
| `--category` | Filter by category. |
| `--origin` | Filter by origin: `link` or `external_connection`. |
| `--source` | Filter by source ID (repeatable). |

See [Pagination](#pagination) for shared list controls.

### Response fields

| Field | Note |
|---|---|
| `amount` | Negative = money leaving the account (debit/purchase), positive = money entering (credit/deposit). |
| `origin` | `external_connection` (from linked bank/card) or `link` (Link-native transaction). |
| `category` | May be `null` if unclassified. |
| `status` | API-provided status string. Do not assume a closed set of values; observed values include `succeeded`. Interpret or filter a status only when its meaning is known. |

For transaction summaries:

- Normalize signs consistently before calculating totals.
- Distinguish debits from credits when possible.
- Group by merchant, category, account, currency, or time period only when relevant.
- Mention if the answer is based on a limited retrieved window.

## Balances

Use balances to answer questions about current account balances or available funds.

```bash
link-cli balances list --format json
link-cli balances list --format json --source <source_id>
```

| Flag | Description |
|---|---|
| `--source` | Filter by source ID (repeatable). |

See [Pagination](#pagination) for shared list controls.

### Response fields

| Field | Note |
|---|---|
| `type` | `cash` (bank/savings) or `credit` (credit card/line of credit). Determines which sub-object is present. |
| `current` | Balance *before* pending transactions. Not the same as available funds. |
| `cash.available` | Object mapping currency codes to available funds (current minus outbound pending plus inbound pending). Only present when `type` is `cash`. |
| `credit.used` | Object mapping currency codes to credit used. Only present when `type` is `credit`. |
| `as_of` | When the balance was last updated — may be stale by hours or days. |

When summarizing balances:

- Preserve currencies.
- Do not add balances across different currencies unless the user explicitly asks and exchange-rate data is available.
- Use the `current` field as the default definition of a balance, unless the user's question requires considering pending transactions.
- If multiple sources are returned, summarize by account/source.

## Sources

Use sources to answer questions about connected wallet sources, linked accounts, or available financial data sources. See [Pagination](#pagination) for shared list controls.

```bash
link-cli sources list --format json
```

### Response fields

| Field | Description |
|---|---|
| `id` | Unique source identifier (same as `source_id` in other endpoints). |
| `name` | Display name of the source. |
| `type` | Source type (e.g. `card`, `bank_account`). |
| `capabilities` | Object indicating what data is available. Each key (e.g. `balances`, `transactions`) maps to an object with a `status` field (e.g. `eligible`). |
| `external_connection.status` | Connection status to the external institution. |
| `granted_actions` | List of actions the user has granted for this source. |

When summarizing sources:

- Include only non-sensitive metadata needed for the answer.
- Avoid exposing full account numbers, credentials, tokens, or payment instrument details.
- Prefer labels such as institution, account type, source status, and last updated time when available.

## Pagination

All three list commands support the same pagination flags:

| Flag | Description |
|---|---|
| `--limit` | Maximum results per page (1-100). Prefer `100` when multiple pages may be needed. |
| `--starting-after` | Fetch the next page after a cursor value. |
| `--ending-before` | Fetch the previous page before a cursor value. Use for reverse navigation, not normal forward collection. |

JSON responses contain a `data` array and may contain `has_more`. They do not provide a separate next-cursor field. When `has_more` is `true`, derive the next cursor from the final item in `data`:

| Command | Next cursor |
|---|---|
| `transactions list` | Final transaction's `id`. |
| `balances list` | Final balance's `source_id`. |
| `sources list` | Final source's `id`. |

For example:

```bash
link-cli transactions list --format json --limit 100 --starting-after <last_transaction_id>
```

Keep all filters identical across pages and change only `--starting-after`. Stop when `has_more` is false or absent, or when enough data has been retrieved for a non-exhaustive lookup. If `has_more` is true but `data` is empty or the required cursor is null or missing, stop and report that pagination could not continue.

Do not exhaustively paginate unless the user’s request requires a complete bounded result, such as a total for a specified time range.

## Answering user questions

When answering:

- State the direct answer first.
- Mention the relevant time range and data source.
- Note any limitations, such as partial pagination, missing categories, pending transactions, or unsupported currencies.
- Avoid dumping raw records and object IDs unless the user asks for them.
- Prefer concise summaries, totals, and notable patterns.

Example response style:

```text
You spent $342.18 on restaurants across 12 transactions in July. The largest restaurant transaction was $86.40 at Example Bistro on July 18. This is based on the transactions returned for your connected Link sources.
```

## Error handling

If authentication fails, ask the user to re-authenticate.

If a command returns no data, say that no matching Link financial data was available for the requested scope.

If the CLI returns an error indicating missing permissions or source actions, request only the specific missing action. Use `auth upgrade` when a session is already authenticated and `auth login` when it is not, then wait for approval before retrying the data command once.

If data is incomplete or paginated, clearly state that the answer is based on the data retrieved so far.

## Guardrails

Do not:

- Move money.
- Initiate payments.
- Modify financial sources.
- Retrieve unrelated financial data.
- Request broader source actions than needed.
- Expose credentials, tokens, or full payment details.
- Present uncertain derived insights as definitive.

Do:

- Use read-only commands.
- Authenticate before retrieval.
- Request the minimum required source actions.
- Use `--format json` for parsing.
- Retrieve only the data needed.
- Summarize clearly and note limitations.
