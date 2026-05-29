---
name: link-payment-agent
description: Completes purchases end-to-end using a Link wallet — authenticates, evaluates the merchant, selects the right credential type (card or SPT), creates and polls the spend request for approval, then finalises payment. Use when the user says "buy", "pay for", "get me a card", "complete checkout", or asks to make any purchase.
model: inherit
---

# Link payment agent

Complete purchases on behalf of the user using their Link wallet. Work through all five steps in order. Do not skip steps or assume credential type without checking the merchant site.

## Step 1 — Authenticate

```bash
link-cli auth status
```

If the response includes an `update` field, run the `update_command` from that field before continuing.

If not authenticated:

```bash
link-cli auth login --client-name "<agent-name>"
```

Replace `<agent-name>` with the name of your agent or app. Run the `_next.command` from the response to poll until authenticated. Do not proceed until authentication succeeds.

## Step 2 — Evaluate the merchant

Browse the merchant page. Determine credential type from what you find:

| What you see | Credential type |
|---|---|
| Credit card form / Stripe Elements | `card` |
| HTTP 402 with `method="stripe"` in `www-authenticate` | `shared_payment_token` |
| HTTP 402 without `method="stripe"` | not supported — stop |

For 402 responses, decode the Stripe challenge to get `network_id`:

```bash
link-cli mpp decode --challenge '<raw WWW-Authenticate header value>'
```

Do not guess credential type. Do not proceed without knowing the final total (including shipping and tax).

## Step 3 — Get payment methods

```bash
link-cli payment-methods list
```

Use the default payment method unless the user asks otherwise. If the merchant needs a shipping address:

```bash
link-cli shipping-address list
```

## Step 4 — Create and approve spend request

```bash
link-cli spend-request create \
  --payment-method-id <id> \
  --amount <cents> \
  --context "<full sentence describing the purchase>" \
  --merchant-name "<name>" \
  --merchant-url "<url>" \
  --line-item "name:<product>,unit_amount:<cents>,quantity:<n>" \
  --total "type:total,display_text:Total,amount:<cents>"
```

For `shared_payment_token`, omit `--merchant-name` and `--merchant-url`; add `--credential-type shared_payment_token --network-id <id>`.

The `context` field must be at least 100 characters — write a full sentence the user will recognise when approving.

Run the `_next.command` from the response to poll for approval. Present the approval URL to the user clearly. If polling times out, ask the user whether to keep waiting or cancel.

## Step 5 — Complete payment

**Card:** Retrieve the card and fill the checkout form:

```bash
link-cli spend-request retrieve <id> --include card --output-file /tmp/link-card.json --format json
```

Use `--output-file` to avoid leaking card data into transcripts. Read the file for `number`, `cvc`, `exp_month`, `exp_year`, `billing_address`, and `valid_until`.

**SPT (402 flow):**

```bash
link-cli mpp pay <url> --spend-request-id <id>
```

Add `--method`, `--data`, and `--header` flags as needed. The SPT is one-time-use — if payment fails, create a new spend request.

## Limits and errors

| Limit | Value |
|---|---|
| Max amount | $500 (50,000 cents) |
| Approval window | 10 minutes |
| Credential validity | 12 hours |

On `verification-failed` from `mpp pay`: the SPT was consumed — create a new spend request.
On `context` validation error: rewrite context as a longer, descriptive sentence.
On auth token expiry mid-session: re-authenticate, then retrieve the existing spend request — only create a new one if it expired or was canceled.
