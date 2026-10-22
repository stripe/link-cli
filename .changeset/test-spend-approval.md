---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
---

Add `test-helpers spend-request approve <id>` to approve pending demo spend requests. Enable with `LINK_TEST_HELPERS=1` or `true`.

Export `BaseResource` so CLI-owned resources can reuse SDK request handling.
