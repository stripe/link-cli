---
'@stripe/link-cli': patch
---

Preserve header overrides regardless of casing when replaying MPP payment continuations, preventing duplicate Content-Type values from breaking JSON payments.
