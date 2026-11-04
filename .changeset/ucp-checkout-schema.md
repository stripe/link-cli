---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
---

Align UCP checkout commands and SDK types with the UCP checkout schema, covering creation, retrieval, completion, updates, and cancellation.

UCP commands show an interactive summary in a terminal without an explicit format. Use `--format json` for the full response, including checkout messages, fulfillment choices, and capability metadata. Piped output and MCP remain structured.

Checkout summaries display buyer details, selected fulfillment destinations and options with labeled method, destination, group, and option IDs, and UCP messages with error codes, severity, field paths, and recovery URLs. Missing buyer details, destinations, or selections are shown explicitly.

- `checkout create` requires `--business` and at least one `--line-item` with an `id` and optional positive integer `quantity` (default 1). Buyer and fulfillment are optional.
- `checkout retrieve` requires a checkout ID and `--business`.
- `checkout complete` requires a positional checkout ID, `--business`, and an approved `--spend-request-id` for the same business, and returns the completion API response.
- `checkout update` requires a checkout ID and `--business`. Line items, buyer, and fulfillment are optional.
- Add `checkout cancel`, which requires a checkout ID and `--business` and returns the canceled checkout.

Retrieve, update, and cancel accept the checkout ID positionally or through `--id`. `--buyer` accepts optional `first_name`, `last_name`, `email`, and `phone_number` fields. `--fulfillment` (also spelled `--fullfilment`) accepts the entire fulfillment object as JSON. The seller determines currency. Responses use UCP statuses, `totals`, `line_items`, and `order`, with `expires_at` as an RFC 3339 timestamp.

Omitted fulfillment during creation uses a complete saved default shipping address when available.
