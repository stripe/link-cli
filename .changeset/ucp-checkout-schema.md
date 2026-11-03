---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
---

Update UCP checkout commands to be more compliant with the UCP specification, covering checkout creation, retrieval, completion, updates, and cancellation.

All UCP commands show an interactive terminal view by default. Use `--format json` for the full JSON response. Interactive completion waits for the payment outcome; JSON completion returns immediately and can be followed with `checkout retrieve --poll --format json`. Retrieval polling shows progress and payment actions in the terminal, or structured results with an explicit format. Piped output and MCP remain structured.

Checkout views display buyer details, selected fulfillment destinations and options, and UCP messages with their error codes, severity, field paths, and recovery URLs. Available choices remain in JSON output. Check the initial completion response and polling responses for checkout errors and required intervention, display the returned messages, and stop waiting when completion cannot proceed. Interactive failures and unresolved actions exit with a nonzero status.

- `checkout create` requires `--business` and at least one `--line-item` with an `id` and optional positive integer `quantity` (default 1). Buyer and fulfillment are optional.
- `checkout retrieve` requires a checkout ID and `--business`. Optional `--spend-request-id` includes payment state and is required for `--poll`.
- `checkout complete` requires a positional checkout ID, `--business`, and an approved `--spend-request-id` for the same business.
- `checkout update` requires a checkout ID and `--business`. Line items, buyer, and fulfillment are optional; omitted sections keep their existing checkout values.
- Add `checkout cancel`, which requires a checkout ID and `--business` and returns the canceled checkout.

Retrieve, update, and cancel accept the checkout ID positionally or through `--id`. `--buyer` accepts comma-separated `first_name`, `last_name`, `email`, and `phone_number` fields, all optional. `--fulfillment` (also spelled `--fullfilment`) accepts the entire fulfillment object as JSON. The seller determines currency. Responses use UCP statuses, `totals`, `line_items`, and `order`, with `expires_at` as an RFC 3339 timestamp.
