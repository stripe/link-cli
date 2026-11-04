---
'@stripe/link-sdk': minor
'@stripe/link-integrations-eve': minor
---

Add `use_approval_policy` to `create_spend_request` and a `retrieve_approval_policy` tool, letting SDK and Eve agents create policy-approved spend requests and read the configured approval policy — the same balance-backed flow `link-cli` already supports.
