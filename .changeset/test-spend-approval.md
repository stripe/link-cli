---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
---

Add `spendRequests.approveTestRequest(id)` and `spendRequests.denyTestRequest(id)` with `test-helpers spend-request approve|deny <id>` for automated decisions on existing test-mode spend requests. Both return `{id, status}`. Retrieve credentials separately after approval. Live requests are rejected by the API.
