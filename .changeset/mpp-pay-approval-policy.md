---
'@stripe/link-cli': patch
---

Add `--use-approval-policy` to `mpp pay` to use delegated approval policies when creating a spend request.

Skip approval polling in `mpp pay` when the new spend request is already approved, returning only the payment continuation.
