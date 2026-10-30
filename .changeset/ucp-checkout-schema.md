---
'@stripe/link-sdk': major
'@stripe/link-cli': major
---

Align UCP checkout requests with the Link UCP API and its `business` parameter. Send nested line items, default quantity to one, support optional buyer fields and full fulfillment JSON, and add PUT checkout updates with optional line items, buyer, and fulfillment. Omitted sections keep their existing checkout values. Retrieve checkouts before payment using their ID and business; optional spend-request payment state is fetched separately for polling. Completion continues to use an approved spend request.

Checkout no longer accepts the DCS `currency`, `fulfillment_details`, or `test` parameters. The CLI accepts `--fulfillment` (also spelled `--fullfilment`) as JSON, and `--buyer` as comma-separated fields. Catalog search retains its existing test mode.

Remove DCS checkout response fields and statuses from the SDK and CLI. Read amounts from `totals`, items from `line_items`, and order confirmation from `order`; `expires_at` is an RFC 3339 string.
