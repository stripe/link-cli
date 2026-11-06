---
"@stripe/link-cli": patch
---

Return UCP checkout completion and retrieval API responses without monitoring spend-request state, including in interactive terminals. Completion still passes the spend-request ID to the server to resolve its shared payment token. Remove checkout retrieval's `--poll`, `--timeout`, and `--spend-request-id` options; inspect payment independently with `spend-request retrieve`.
