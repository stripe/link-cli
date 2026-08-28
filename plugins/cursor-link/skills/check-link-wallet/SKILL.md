---
name: check-link-wallet
description: Reads the connected Link account, the cards and bank accounts saved in its wallet, its saved shipping addresses, and the status of existing spend requests. Use when the user asks which Link account is connected, what payment methods or addresses Link has saved, or whether a Link purchase has been approved yet.
---

# Check a Link wallet

Read-only inspection of the connected Link account through the Link MCP
server. Nothing here moves money or changes a spend request.

To actually buy something, use the `complete-link-purchase` skill instead.

## Tools

| Question | Tool |
|---|---|
| Which account is connected? | `get_userinfo` |
| What cards and bank accounts are saved? | `list_payment_methods` |
| What shipping addresses are saved? | `list_shipping_addresses` |
| What purchases are pending or approved? | `list_spend_requests` |
| What is the status of one purchase? | `get_spend_request` |

Call only the tool that answers the question. Do not sweep all five to build a
picture the user did not ask for.

## Spend request status

`list_spend_requests` returns only active requests by default — those in
`created`, `pending_approval`, or `approved`. Pass `includeHistory` when the
user is asking about something that already finished or expired.

The statuses mean:

- **`created`** — exists, but the user has not been asked to approve it yet.
- **`pending_approval`** — waiting on the user. They approve in the Link app.
- **`approved`** — ready to spend against.
- Expired and terminal states are only visible with `includeHistory`, and
  cannot be spent against. A user who still wants the purchase needs a fresh
  one, raised with `request_virtual_card` — but only if they ask for it. Do not
  offer to re-run a purchase off the back of a status question.

`get_spend_request` returns the status of a single request by id. **Do not pass
the `include` parameter here.** `include: ["card"]` and
`include: ["shared_payment_token"]` return live payment credentials, and they
belong only in the moment of paying, which is the other skill's job.

## What to expose

- Summarize. Do not dump raw JSON or object ids unless the user asks.
- Payment methods: brand, type, and last four only. Never a full number.
- Shipping addresses: city and postcode by default. Give the full address only
  if the user asks for it.
- Never surface tokens, credentials, or internal identifiers as an aside.

## When the account is not connected

An authorization error from any of these tools means the user has not connected
Link in Cursor, or the connection has lapsed. Say so plainly and let them
reconnect. Do not retry in a loop, and do not try another tool hoping for a
different answer.
