---
'@stripe/link-cli': patch
---

Add `--use-approval-policy` to `mpp pay` to use delegated approval policies when creating a spend request.

Return MPP payment continuations based on the spend request status: continue directly to payment for approved requests, reuse spend-request approval and verification instructions while waiting, and omit continuations for requests that cannot proceed. Expose the next command consistently as `_next.argv`, retaining existing MPP continuation fields for compatibility.
