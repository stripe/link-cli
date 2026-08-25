---
"@stripe/link-cli": patch
---

Honor Payment-Authorization in `mpp pay` so Payment credentials can coexist with ordinary Authorization. Challenges may select only Authorization (default) or Payment-Authorization.
