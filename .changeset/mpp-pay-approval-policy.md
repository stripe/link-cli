---
'@stripe/link-cli': patch
---

Add `--use-approval-policy` to `mpp pay` to use delegated approval policies when creating a spend request.

Return MPP payment continuations based on the spend request status: skip approval polling for approved requests, follow verification actions when required, and omit continuations for requests that cannot proceed.
