---
"@stripe/link-cli": patch
"@stripe/link-sdk": patch
"@stripe/link-integrations-eve": patch
---

Support the `partner_auth_challenge` and `partner_auth_challenge_retry` next actions. Interactive `spend-request create --request-approval` and `spend-request request-approval` now keep polling through any `auto_resume` action reached after approval instead of exiting, and agent-mode guidance for `auto_resume` no longer assumes 3D Secure.
