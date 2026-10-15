---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
---

Add `spendRequests.approveTestRequest(id)` and `test-helpers spend-request approve <id>` for automated approval of existing test-mode spend requests. Both return the updated SpendRequest resource. Live requests are rejected by the API.
