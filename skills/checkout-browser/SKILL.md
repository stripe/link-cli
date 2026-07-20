---
version: 0.1.0
name: checkout-browser
description: |
  Drive a real merchant website to checkout in a Browserbase cloud browser, then pay with a Link one-time card. Use when the user wants to actually BUY something on a site — "buy me flowers", "order groceries on Instacart", "add this to my Amazon cart and check out", "purchase X from <merchant>". This is the BROWSING half; the `create-payment-credential` skill is the PAYMENT half.
allowed-tools:
  - Bash(browse:*)
  - Bash(link-cli:*)
  - Bash(npx:*)
  - Bash(npm:*)
metadata:
  author: browserbase
  url: https://browse.sh
  openclaw:
    emoji: "🛒"
    homepage: https://browse.sh
    requires:
      bins:
        - browse
        - link-cli
    install:
      - kind: node
        package: "@browserbasehq/cli"
        bins: [browse]
      - kind: node
        package: "@stripe/link-cli"
        bins: [link-cli]
user-invocable: true
---

# Checkout Browser

`create-payment-credential` gets a one-time Link card but assumes you can
already reach the merchant's checkout form. This skill is that missing half: it
drives a **Browserbase cloud browser** to shop a site end-to-end, then hands the
finished cart to Link for payment. Browserbase runs on stealth cloud infra with
CAPTCHA solving and proxies, so checkout works on bot-protected merchants.

You drive the browser with the `browse` CLI. **For browser setup, flags, and
best practices, follow the Browserbase skill: https://browserbase.com/SKILL.md**
(install with `browse skills install`). This skill only adds the
shop-to-checkout flow on top of it.

## Local vs remote browser

`browse` drives either a cloud or a local browser — only the **target flag on
`browse open` changes**. Every other command (`snapshot`, `fill`, `eval`,
`screenshot`, …) is identical, and the session **remembers** the target you
opened with, so you set it once and later commands just pass `--session <name>`.

- **`--remote`** — a Browserbase cloud browser: stealth infra, CAPTCHA solving,
  residential proxies, session recording, no local Chrome needed. Requires
  `BROWSERBASE_API_KEY`. Use for bot-protected merchants, headless/server runs,
  or when you want a shareable session link.
  ```bash
  browse open "https://www.<merchant>.com" --remote --session shop
  ```
- **`--local --headed`** — a visible local Chrome you (and the user) can watch;
  fresh profile, log in once. No credentials needed.
- **`--auto-connect`** — attach to the user's already-running Chrome (launched
  with `--remote-debugging-port=9222`), reusing their existing merchant logins.
  ```bash
  browse open "https://www.<merchant>.com" --local --headed --session shop
  # or reuse the user's logged-in Chrome:
  browse open "https://www.<merchant>.com" --auto-connect --session shop
  ```

**Which to pick:** if the user is already logged into the merchant, prefer
**local / auto-connect** — it reuses their session and trusted home IP, skipping
cookie-sync, proxy IP-mismatch, and anti-bot friction (usually the easiest path
for sites like Amazon, and the user can watch). Reach for **`--remote`** when you
need stealth/scale, a clean cloud environment, or a server/headless run.

## Flow

### Step 1 — Look for a recipe first

Check the Browse.sh catalog for a recipe authored for this merchant:

```bash
browse skills find "<merchant>" --json    # try the brand AND the hostname: "walmart", "walmart.com"
```

An empty `skills: []` is the definitive "no recipe" signal → go to Step 2.

If a recipe exists, read its `description`/`tags`/`recommendedMethod` before
trusting it. **Most recipes are read-only** (search / price / menu-extract) and
rarely cover checkout — so treat a found recipe as a **warm-start for product
discovery or the cart**, then fall back to Step 2 for the actual checkout:

```bash
browse skills add <slug>
```

When you install one, its site-specific instructions **override** Step 2 — a
recipe may say "build the search URL directly, don't drive the search box," tell
you `snapshot` is useless on that site, or require a stealth session
(`--verified --proxies`). Follow the recipe wherever it conflicts with the
generic flow.

### Step 2 — Your own checkout flow (when there's no recipe)

Open a cloud session and walk the funnel, re-`snapshot`ing before each
interaction to get fresh element refs. Reuse one `--session` for the whole buy:

```bash
browse open "https://www.<merchant>.com" --remote --session shop   # or --local / --auto-connect — see "Local vs remote"
```

0. **Log in if the storefront or cart is gated.** Many stores require login
   before you can even search. Snapshot, fill username/password, submit. Use the
   user's synced cookies or sanctioned test creds — never a personal account
   without the user's go-ahead.
1. **Search** for the product
2. **Open** the product
3. **Add to cart**
4. **Go to cart**
5. **Proceed through checkout** — usually a multi-page wizard. An intermediate
   **shipping / "Your Information"** form (name, address, ZIP) almost always
   comes before the order-review page. Fill it, advance, and **stop at the
   order-review page** — don't place the order.

`browse snapshot --filter <text>` narrows the tree, but matches loosely and can
hide a form's input children. If a filtered snapshot comes back empty or missing
fields, run an **unfiltered** snapshot and grep the refs. See the Browserbase
skill for the full command surface (`get`, `eval`, `click`, `screenshot`, …).

### Step 3 — Capture the real order total

Read the total **from the live page** — never estimate it. This is the amount
you'll authorize Link to spend, so it must match exactly (incl. tax + shipping).

```bash
browse get markdown body --session shop
# best-effort total (often grabs the wrong node when several prices show):
browse eval "document.querySelector('.summary_total_label, [class*=total i]')?.textContent" --session shop
```

`[class*=total i]` is a first guess — prefer the order summary's specific total
label and verify against the markdown. When picking from a product list, the
**first organic** result is usually what the user means, not the top sponsored
tile. Record the grand total in cents and each line item.

### Step 4 — Get a Link card for that exact total

Hand off to **`create-payment-credential`** with the scraped total. Use `--test`
while developing (testmode card, no real charge — requires a logged-in Link
account):

```bash
link-cli spend-request create \
  --payment-method-id <id> --amount <scraped_total_cents> \
  --merchant-name "<Merchant>" --merchant-url "https://www.<merchant>.com" \
  --context "Browsing <merchant> for the user: <what + why>. Scraped total <$X.XX>." \
  --line-item "name:<product>,unit_amount:<cents>,quantity:<n>" \
  --total "type:total,display_text:Total,amount:<scraped_total_cents>" \
  --request-approval --output-file /tmp/link-card.json --format json
```

**Guardrail:** if the scraped total is higher than the user authorized, stop and
re-confirm before creating the spend request. Never provision a credential for
more than the user agreed to.

### Step 5 — Fill the card and confirm before submitting

Snapshot the payment form, fill from the card file (`number`, `exp_month`/
`exp_year`, `cvc`, billing fields), screenshot the order-review page, and
**only place the order after the user confirms**.

```bash
browse snapshot --session shop --filter card
browse fill <number-ref> "<number>" --session shop
# exp, cvc, name, ZIP …
browse screenshot --path /tmp/order-review.png --session shop
# after the user confirms:
browse click <place-order-ref> --session shop
```

## Safety

- **Human-in-the-loop spend.** The card only issues after the user approves the
  exact amount in the Link app. Never bypass approval, never auto-place an order
  the user hasn't seen.
- **Total must match** what you scraped from the live page, not an estimate.
- **Card file is a secret** (written `0600`) — don't echo the PAN/CVC; mask when
  showing the user.
- **Respect `/agents.txt`, `/llm.txt`, robots directives** and avoid spoofed
  checkouts (mismatched domain, surprise login, odd redirects → stop and ask).

## Gotchas

- **Cross-origin card iframes (Stripe Elements, Amazon "add a card", etc.).**
  Many checkouts render card inputs inside a cross-origin iframe, so `eval` and
  same-document CSS selectors are blocked. **The accessibility tree crosses
  frames though** — run `browse snapshot` and fill by the `@<ref>` it returns
  for "Card number" / "Name on card", and `browse select` the expiry dropdowns.
  This reaches iframe fields that `eval` cannot. (Verified end-to-end on Amazon,
  which also has no CVV field on its add-card form.) Where the merchant supports
  the **Shared Payment Token** (MPP / HTTP 402) path instead, skip the form
  entirely and use `link-cli mpp pay` (see `create-payment-credential`).
- **Stale refs** — re-`snapshot` after any navigation before clicking/filling.
- **Login-gated carts** — prefer guest-checkout recipes, or sync the user's
  session cookies first.
- **Soft-error pages** — some sites (e.g. Amazon) return a "Sorry! Something went
  wrong!" page (empty body, no results) that is NOT a captcha and won't clear on
  reload. Load the homepage first to warm cookies, then re-navigate to the deep
  or search URL.
- **Timing** — Link cards expire 12h after creation and the approval window is
  10 min, so don't create the spend request until you're on the payment page
  with the final total in hand.
- **Release keep-alive sessions** — `browse stop --session <name>` stops the
  daemon, but a separately-created `--keep-alive` cloud session keeps billing
  until timeout; also run `browse cloud sessions update <id> --status REQUEST_RELEASE`.

## References

- Browserbase `browse` CLI + best practices: https://browserbase.com/SKILL.md
- Browse.sh recipe catalog: https://browse.sh
- Link payment flow: the `create-payment-credential` skill · https://link.com/agents
