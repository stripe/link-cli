---
"@stripe/link-cli": minor
---

Add a top-level `link-cli pay <url>` command with the same behavior as
`mpp pay`, so agents don't need to know which payment protocol a URL uses.
`mpp pay` and `mpp decode` continue to work unchanged.
