---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
---

Update UCP checkout commands to be more compliant with the UCP specification, covering checkout creation, retrieval, completion, updates, and cancellation.

- `checkout create` requires `--business` and at least one `--line-item` with an `id` and optional positive integer `quantity` (default 1). Buyer and fulfillment are optional.
- `checkout retrieve` requires a checkout ID and `--business`. Optional `--spend-request-id` includes payment state and is required for `--poll`.
- `checkout complete` requires a positional checkout ID, `--business`, and an approved `--spend-request-id` for the same business.
- `checkout update` requires a checkout ID and `--business`. Line items, buyer, and fulfillment are optional; omitted sections keep their existing checkout values.
- Add `checkout cancel`, which requires a checkout ID and `--business` and returns the canceled checkout.

Retrieve, update, and cancel accept the checkout ID positionally or through `--id`. `--buyer` accepts comma-separated `first_name`, `last_name`, `email`, and `phone` fields, all optional. `--fulfillment` (also spelled `--fullfilment`) accepts the entire fulfillment object as JSON. The seller determines currency. Responses use UCP statuses, `totals`, `line_items`, and `order`, with `expires_at` as an RFC 3339 timestamp.
