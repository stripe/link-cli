---
"@stripe/link-cli": minor
"@stripe/link-sdk": minor
"@stripe/link-integrations-eve": patch
---

Add optional completion callback URL and nonce inputs to spend-request creation. CLI and agent tools require both or neither, validate URL and nonce limits, and preserve the supplied values unchanged. Returned approval and supported action URLs carry the backend-provided callback context; response parsing and polling behavior are unchanged.
