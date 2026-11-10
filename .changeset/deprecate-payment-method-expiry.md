---
'@stripe/link-sdk': major
---

Remove the deprecated `exp_month` and `exp_year` fields from saved payment-method `CardDetails`. Consumers should use `brand` and `last4` to identify saved cards. Additional API fields continue to pass through at runtime.

SpendRequest `card` credentials retain `exp_month` and `exp_year` for checkout.
