---
version: 0.7.2
name: create-payment-credential
description: |
  Gets secure, one-time-use payment credentials (cards, tokens) from a Link wallet so agents can complete purchases on behalf of users. Use when the user says "get me a card", "buy something", "pay for X", "make a purchase", "I need to pay", "complete checkout", or asks to transact on any merchant site. Use when the user asks to connect or log in to or sign up for their Link account.
allowed-tools:
 - Bash(link-cli:*)
 - Bash(npx:*)
 - Bash(npm:*)
license: Complete terms in LICENSE
metadata:
  author: stripe
  url: link.com/agents
  openclaw:
    emoji: "💳"
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

# Create Payment Credential

Use [Link](https://link.com) to get secure, one-time-use payment credentials from a Link wallet to complete purchases.

The CLI can produce one of two credential types:
- A virtual card (PAN) for use with a standard web checkout form. The issued card works anywhere.
- A Shared Payment Token (SPT) when the seller is in the Stripe Network and accepts payments programmatically (for example with Machine Payment Protocols).

## Installing

Install with `npm install -g @stripe/link-cli`. Or run directly with `npx @stripe/link-cli`.

## Running commands

Link CLI can run as an **MCP server** or as a **standalone CLI**.

**MCP:** Add the following to your MCP client config (`.mcp.json`, etc.)

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

Run the MCP server directly with `npx @stripe/link-cli@latest --mcp`.

Call `tools/list` to see all available MCP tools.

### Common commands/options

- List all commands: `link-cli --llms`
- List all commands with parameters: `link-cli --llms-full`
- Get a command's exact schema with `--schema`. For example, `link-cli spend-request create --schema`
- Multi-step commands return a `_next` action. For example, authenticating or creating a spend request returns a `_next.command` that must be run to complete the flow.
- By default all output is in `toon` format. Pass `--format [json|md|yaml]` to change output format.
- Some commands return a verification or approval URL. **These** must be presented to the user clearly for their action.
- `--auth <path>` flag to store auth credentials in a specific file instead of the default location. `auth login` writes to this file; all other commands read from it. Example: `link-cli auth login --auth credentials.json`

_Recommended_: Run `link-cli --llms` to understand all the available commands. The `--llms-full` output is the canonical reference for parameter names, types, and valid values. Pass `--schema` before invoking a command to understand its parameters and constraints.

## Core flow

Copy this checklist and track progress:

- Step 1: Authenticate with Link
- Step 2: Evaluate merchant site (determine credential type)
- Step 3: Get payment methods
- Step 4: Create spend request with correct credential type
- Step 5: Complete payment

### Step 1: Authenticate with Link

Check auth status:

```bash
link-cli auth status
```

If the response includes an `update` field, a newer version of `link-cli` is available — run the `update_command` from that field to upgrade before proceeding.

If not authenticated:

```bash
link-cli auth login --client-name "<your-agent-name>"
```

Replace `<your-agent-name>` with the name of your agent or application (for example, `"Personal Assistant"`, `"Shopping Bot"`). This name appears in the user's Link app when they approve the connection. Use a clear, unique, identifiable name.

The response includes a `_next` command — run it to poll until authenticated. If your environment cannot relay the verification code while a separate polling command blocks I/O, use inline polling instead: `auth login --client-name "<name>" --interval 5 --timeout 300`. This yields the code immediately then polls in the same command.

DO NOT PROCEED until the user is authenticated with Link.

Always check the current authentication status before starting a new login flow — the user might already be logged in.

### Step 2: Evaluate the merchant site BEFORE creating a spend request

**CRITICAL:** Before calling `spend-request create` you must complete this checklist:
1. Understand how the merchant accepts payments (cards or machine payments or other). **Do NOT** default to `card` credential type. The merchant determines the credential type — you cannot know it without checking first. Skipping this step will produce a spend request with the wrong credential type.
2. Have the final total amount needed. Inclusive of any shipping costs, taxes or other costs. Skipping this step will produce a spend request that does not cover the full amount needed, and will be rejected.
3. Clear context and understanding of what the user is purchasing. Be sure to know sizes, colors, shipping options, etc. Skipping this step will produce a spend request that the user does not recognize or understand.

**Determine how the merchant accepts payment:**

1. **Navigate to the merchant page** — browse it, read the page content, and understand how the site accepts payment.
2. **If the page has a credit card form, Stripe Elements, or traditional checkout UI** — use `card`.
3. **If the page describes an API or programmatic payment flow** — make a request to the relevant endpoint. If it returns **HTTP 402** with a `www-authenticate` header, use `shared_payment_token`.

What you find determines which credential type to use:

| What you see | Credential type | What to request |
|---|---|---|
| Credit card form / Stripe Elements | `card` (default) | Card |
| HTTP 402 with `method="stripe"` in `www-authenticate` | `shared_payment_token` | Shared payment token (SPT) |
| HTTP 402 without `method="stripe"` in `www-authenticate` | not supported | Do not continue |

**If the merchant site returns 403 (bot protection):**

Some merchants use Cloudflare or Vercel bot protection that blocks automated requests. If you receive a 403 when browsing the merchant site, use `web-bot-auth sign` to obtain signed headers:

```bash
link-cli web-bot-auth sign <merchant-url>
```

Attach the returned `Signature` and `Signature-Input` headers to your HTTP requests to the merchant. The headers are valid for ~10 minutes and are scoped to the merchant's domain.

**For 402 responses:** The `www-authenticate` header may contain **multiple** payment challenges (e.g. `tempo`, `stripe`) in a single header value. Do not try to decode the payload manually. Pass the **full raw `WWW-Authenticate` header value** to Link CLI and let `mpp decode` select and validate the `method="stripe"` challenge.

To derive `network_id`, use Link CLI's challenge decoder:

```bash
link-cli mpp decode --challenge '<raw WWW-Authenticate header>'
```

This validates the Stripe challenge, decodes the `request` payload, and returns both the extracted `network_id` and the decoded request JSON. Pass the full header exactly as received, even if it also contains non-Stripe or multiple `Payment` challenges.

### Step 3: Get payment methods and potentially shipping addresses

Use the default payment method, unless the user explicitly asks to select a different one.

```bash
link-cli payment-methods list
```

If the merchant checkout requires a shipping or delivery address, fetch the user's saved shipping addresses. Use the default address unless the user specifies otherwise.

```bash
link-cli shipping-address list
```

### Step 4: Create the spend request with the right credential type

```bash
link-cli spend-request create \
  --payment-method-id <id> \
  --amount <cents> \
  --context "<description>" \
  --merchant-name "<name>" \
  --merchant-url "<url>" \
  --line-item "name:<product>,unit_amount:<cents>,quantity:<n>" \
  --total "type:total,display_text:Total,amount:<cents>" \
 
```

**`--line-item` keys:** `name` (required), `quantity`, `unit_amount`, `description`, `sku`, `url`, `image_url`, `product_url`. Repeatable for multiple items.

**`--total` keys:** `type` (required; one of: `subtotal`, `tax`, `total`, `items_base_amount`, `items_discount`, `discount`, `fulfillment`, `shipping`, `fee`, `gift_wrap`, `tip`, `store_credit`), `display_text` (required), `amount` (required). Repeatable (e.g. subtotal + tax + shipping + total).

Do not proceed to payment while the request is still `created` or `pending_approval`. If polling exits with `POLLING_TIMEOUT`, keep waiting or ask the user whether to continue polling. If they deny, ask for clarification what to do next. If the user wants to abort, cancel the spend request:

```bash
link-cli spend-request cancel <id>
```

Recommend the user approves with the [Link app](https://link.com/download). Show the download URL.

**Test mode:** Add `--test` to create testmode credentials instead of real ones. Useful for development and integration testing.

### Step 5: Complete payment

**Card:** Run `link-cli spend-request retrieve <id> --include card` to get the `card` object with `number`, `cvc`, `exp_month`, `exp_year`, `billing_address` (name, line1, line2, city, state, postal_code, country), and `valid_until` (Unix timestamp — the card stops working after this time). Enter these details into the merchant's checkout form.

**Safe credential handoff:** To avoid leaking card data into transcripts or logs, add `--output-file <path>` to write the full card to a local file (created with `0600` permissions) while stdout shows only redacted data. Use `--force` to overwrite an existing file. Example:

```bash
link-cli spend-request retrieve <id> --include card --output-file /tmp/link-card.json --format json
```

**SPT with 402 flow:** The SPT is **one-time use** — if the payment fails, you need a new spend request and new SPT.

```bash
link-cli mpp pay <url> --spend-request-id <id> [--method POST] [--data '{"amount":100}'] [--header 'Name: Value']
```

`mpp pay` handles the full 402 flow automatically: probes the URL, parses the `www-authenticate` header, builds the `Authorization: Payment` credential using the SPT, and retries.


## Important

- Treat the user's payment methods, credentials, and shipping addresses as sensitive — card numbers and SPTs grant real spending power; shipping addresses are PII. Mask or abbreviate addresses when displaying to the user (e.g. show city and zip only) unless they request full details.
- Respect `/agents.txt` and `/llm.txt` and other directives on sites you browse — these files declare whether the site permits automated agent interactions; ignoring them may violate the merchant's terms.
- Avoid suspicious merchants, checkout pages and websites — phishing pages that mimic legitimate merchants can steal credentials; if anything about the page feels off (mismatched domain, unusual redirect, unexpected login prompt), stop and ask the user to verify.
- When outputting card information to the user apply basic masking to the card number and address to protect their information. Only reveal the raw values if directly requested to do so.

## Limits

| Limit | Value |
|-------|-------|
| Max amount per spend request | $5,000 (500,000 cents) |
| Approval window | 10 minutes — user must approve within 10 min of `spend-request request-approval` |
| Card / SPT validity (`valid_until`) | 12 hours from spend request creation |
| Daily spend per account | $5,000 |
| Monthly spend per account (30 days) | $20,000 |
| Concurrent active requests (created + approved) | 30 |
| Concurrent approved requests | 10 |
| Hourly creation rate | 50 per hour |
| Rolling creation rate | 200 per 60 days |

If a spend request is created but approval is not requested within the window, or the user does not approve within 10 minutes, the request expires. Create a new one. Do not poll indefinitely — if the approval window is nearly exhausted and the user hasn't responded, surface this to the user.

## Errors

All errors are output as JSON with `code` and `message` fields, with exit code 1.

### Common errors and recovery

| Error / Symptom | Cause | Recovery |
|---|---|---|
| `verification-failed` in error body from `mpp pay` | SPT was already consumed (one-time use) | Create a new spend request with `credential_type: "shared_payment_token"` — do not retry with the same spend request ID |
| `context` validation error on `spend-request create` | `context` field is under 100 characters | Rewrite `context` as a full sentence explaining what is being purchased and why; the user reads this when approving |
| API rejects `merchant_name` or `merchant_url` | These fields are forbidden when `credential_type` is `shared_payment_token` | Remove both fields from the request; SPT flows identify the merchant via `network_id` instead |
| Spend request approved but payment fails immediately | Wrong credential type for the merchant (e.g. `card` on a 402-only endpoint) | Go back to Step 2, re-evaluate the merchant, create a new spend request with the correct `credential_type` |
| Auth token expired mid-session (exit code 1 during approval polling) | Token refresh failure during background polling | Re-authenticate with `auth login`, then retrieve the existing spend request or resume polling. Only create a new spend request if the original one expired, was denied, was canceled, or its shared payment token was already consumed |
| 403 when browsing merchant site in Step 2 | Bot protection (Cloudflare/Vercel) blocking automated requests | Run `link-cli web-bot-auth sign <url>` and attach the returned `Signature` and `Signature-Input` headers to your browsing requests |

## Reporting outcomes

After a purchase attempt, you're encouraged to report the outcome — whether it succeeded, was blocked, or was abandoned. This is optional but helps Stripe improve checkout for agents.

```bash
link-cli report \
  --domain <merchant-domain> \
  --outcome <success|blocked|abandoned> \
  --spend-request-id <lsrq_...> \
  [--tag <tag>] \
  [--step <step>] \
  [--freeform-context "<details>"]
```

### When to report

- **success** -- payment completed and order confirmed
- **blocked** -- the agent could not complete payment due to an obstacle (captcha, WAF, rate limit, etc.)
- **abandoned** -- the agent chose to stop (user canceled, site error, timeout, etc.)

### Tags

Add one or more `--tag` flags to classify what happened. Prefer the most specific tag; use `other` only when none of the others apply, and describe what happened in `--freeform-context`.

| Tag | Meaning |
|---|---|
| `stripe_checkout` | Merchant uses Stripe checkout |
| `captcha` | Blocked by CAPTCHA |
| `anti_bot_script` | Blocked by bot detection script |
| `cdn_block` | Blocked by CDN (Cloudflare, etc.) |
| `waf_block` | Blocked by WAF |
| `dns_block` | DNS-level block |
| `rate_limited` | Rate limited |
| `login_required` | Login wall prevented checkout |
| `3ds_challenge` | 3DS challenge could not be completed |
| `page_inaccessible` | Page returned error or could not load |
| `timeout` | Operation timed out |
| `site_error` | Merchant site returned an error |
| `payment_declined` | Payment was declined by processor |
| `other` | Other (describe in freeform-context) |

### Examples

```bash
# Successful purchase
link-cli report --domain shop.example.com --outcome success --spend-request-id lsrq_abc123

# Blocked by captcha
link-cli report --domain shop.example.com --outcome blocked --spend-request-id lsrq_abc123 --tag captcha --step "checkout page"

# Abandoned due to site error
link-cli report --domain shop.example.com --outcome abandoned --spend-request-id lsrq_abc123 --tag site_error --freeform-context "500 error on payment submission"
```

Report output is agent-only (not shown to the user). Reporting is encouraged but not required, including when the purchase failed.

## Further docs

- MPP/x402 protocol: https://mpp.dev/protocol.md, https://mpp.dev/protocol/http-402.md, https://mpp.dev/protocol/challenges.md
- Link: https://link.com/agents
- Link App (for account management): https://app.link.com
- Link support (if the user needs help with Link): https://support.link.com/topics/about-link
