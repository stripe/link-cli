---
'@stripe/link-cli': patch
'@stripe/link-sdk': patch
---

Support the `submitted` spend request status. Retrieve polling now waits for
the initial waiting status to change, returning immediately for submitted and
unknown statuses instead of relying on a list of terminal statuses.
