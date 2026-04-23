---
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

# Creating Payment Credentials

Use the Link CLI to get secure, one-time-use payment credentials from a Link wallet to complete purchases.

## Running commands

All commands support `--output-json` for machine-readable output. Use `--json` to pass structured input. Always run `link-cli <command> --help` before running the command to see full schema details, including all fields, types, and constraints.

IMPORTANT: Run `auth login`, `spend-request create`, and `spend-request request-approval` with `run_in_background=true` (or `TaskOutput(task_id, block: false)`). These commands emit JSON to stdout before they exit, then keep running while they poll for user action.

The JSON stream contract for these long-running commands is:

- `auth login --output-json`: first object contains `verification_url` and `passphrase`; final object contains authentication result after approval succeeds
- `spend-request create --request-approval --output-json`: first object is the created spend request; final object is the terminal spend request after polling completes
- `spend-request request-approval --output-json`: first object contains the approval link; final object is the terminal spend request after polling completes

Always keep reading stdout until the process exits. Do not assume the first JSON object is the full result. The user MUST visit the verification or approval URL to continue, and you should always show that full URL in clear text.

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
link-cli auth status --output-json
```

If not authenticated:

```bash
link-cli auth login --client-name "<your-agent-name>" --output-json
```

Replace `<your-agent-name>` with the name of your agent or application (e.g. `"Personal Assistant", "Shopping Bot"`). This name appears in the user's Link app when they approve the connection. Use a clear, unique, identifiable name. Display the url and passphase to the user, with the guidance "Please visit the following URL to approve secure access to Link.”

DO NOT PROCEED until the user is authenticated with Link.

### Step 2: Evaluate the merchant site BEFORE creating a spend request

**CRITICAL — You MUST complete this step before calling `spend-request create`.** Do NOT default to `card` credential type. The merchant determines the credential type — you cannot know it without checking first. Skipping this step will produce a spend request with the wrong credential type.

Determine how the merchant accepts payment:

1. **Navigate to the merchant page** — browse it, read the page content, and understand how the site accepts payment.
2. **If the page has a credit card form, Stripe Elements, or traditional checkout UI** — use `card`.
3. **If the page describes an API or programmatic payment flow** — make a request to the relevant endpoint. If it returns **HTTP 402** with a `www-authenticate` header, use `shared_payment_token`.

What you find determines which credential type to use:

| What you see | Credential type | What to request |
|---|---|---|
| Credit card form / Stripe Elements | `card` (default) | Card |
| HTTP 402 with `method="stripe"` in `www-authenticate` | `shared_payment_token` | Shared payment token (SPT) |
| HTTP 402 without `method="stripe"` in `www-authenticate` | not supported | Do not continue |

**For 402 responses:** The `www-authenticate` header may contain **multiple** payment challenges (e.g. `tempo`, `stripe`) in a single header value. Do not try to decode the payload manually. Pass the **full raw `WWW-Authenticate` header value** to Link CLI and let `mpp decode` select and validate the `method="stripe"` challenge.

To derive `network_id`, use Link CLI's challenge decoder:

```bash
link-cli mpp decode --challenge '<raw WWW-Authenticate header>' --output-json
```

This validates the Stripe challenge, decodes the `request` payload, and returns both the extracted `network_id` and the decoded request JSON. Pass the full header exactly as received, even if it also contains non-Stripe or multiple `Payment` challenges.

### Step 3: Get payment methods

Use the default payment method, unless the user explicitly asks to select a different one.

```bash
link-cli payment-methods list --output-json
```

### Step 4: Create the spend request with the right credential type

```bash
link-cli spend-request create --json "{request}" --output-json
```

Important: use the --json method to create the request.

Wait until the user has approved the spend request. If they deny, ask for clarification what to do next.

Recommend the user approves with the [Link app](https://link.com/download). Show the download URL.

**Test mode:** Add `"test": true` to the JSON input (or `--test` flag) to create testmode credentials instead of real ones. Useful for development and integration testing.

### Step 5: Complete payment

**Card:** The approved spend request includes a `card` object with `number`, `cvc`, `exp_month`, `exp_year`, `billing_address` (name, line1, line2, city, state, postal_code, country), and `valid_until` (unix timestamp — the card stops working after this time). Enter these details into the merchant's checkout form. If you need to fetch them again, run `link-cli spend-request retrieve <id> --output-json` and use the returned `card` field.

**SPT with 402 flow:** The SPT is **one-time use** — if the payment fails, you need a new spend request and new SPT.

```bash
link-cli mpp pay <url> --spend-request-id <id> [--method POST] [--data '{"amount":100}'] [--header 'Name: Value'] --output-json
```

`mpp pay` handles the full 402 flow automatically: probes the URL, parses the `www-authenticate` header, builds the `Authorization: Payment` credential using the SPT, and retries.


## Important

- Treat the user's payment methods and credentials extremely carefully — card numbers and SPTs grant real spending power; leaking them outside a secure checkout could result in unauthorized charges the user cannot reverse.
- Respect `/agents.txt` and `/llm.txt` and other directives on sites you browse — these files declare whether the site permits automated agent interactions; ignoring them may violate the merchant's terms.
- Avoid suspicious merchants, checkout pages and websites — phishing pages that mimic legitimate merchants can steal credentials; if anything about the page feels off (mismatched domain, unusual redirect, unexpected login prompt), stop and ask the user to verify.
- NEVER expose payment credentials (card numbers, SPTs) outside of a secure checkout form or the 402 payment flow — logging them, passing them to other tools, or including them in summaries creates unnecessary exposure vectors.
- DO NOT use playwright or other automated browsers to authenticate with Link or approve a request on behalf of the user.

## Errors

All errors go to stderr as `{"error": "..."}` with exit code 1.

### Common errors and recovery

| Error / Symptom | Cause | Recovery |
|---|---|---|
| `verification-failed` in error body from `mpp pay` | SPT was already consumed (one-time use) | Create a new spend request with `credential_type: "shared_payment_token"` — do not retry with the same spend request ID |
| `context` validation error on `spend-request create` | `context` field is under 100 characters | Rewrite `context` as a full sentence explaining what is being purchased and why; the user reads this when approving |
| API rejects `merchant_name` or `merchant_url` | These fields are forbidden when `credential_type` is `shared_payment_token` | Remove both fields from the request; SPT flows identify the merchant via `network_id` instead |
| Command hangs indefinitely | `auth login` or `spend-request create` run synchronously | Always run these commands with `run_in_background=true` — they block until the user acts, so synchronous execution freezes the agent |
| Spend request approved but payment fails immediately | Wrong credential type for the merchant (e.g. `card` on a 402-only endpoint) | Go back to Step 2, re-evaluate the merchant, create a new spend request with the correct `credential_type` |
| Auth token expired mid-session (exit code 1 during approval polling) | Token refresh failure during background polling | Re-authenticate with `auth login`, then retrieve the existing spend request or resume polling. Only create a new spend request if the original one expired, was denied, or its shared payment token was already consumed |

## Further docs

- MPP/x402 protocol: https://mpp.dev/protocol.md, https://mpp.dev/protocol/http-402.md, https://mpp.dev/protocol/challenges.md
- Link: https://link.com/agents
- Link App (for account management): https://app.link.com
- Link support (if the user needs help with Link): https://support.link.com/topics/about-link
