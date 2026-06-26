---
"@stripe/link-cli": patch
---

Make payment-method-id optional in spend-request create; if omitted, the default payment method will be used, or the first eligible one if no default is set
