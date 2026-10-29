---
'@stripe/link-sdk': major
'@stripe/link-cli': major
---

Remove balance eligibility from user info. The TypeScript SDK no longer exposes `eligible_for_balance`, the Go SDK no longer exposes `EligibleForBalance`, and CLI JSON and interactive output omit the field even when the server still returns it.
