---
'@stripe/link-cli': patch
---

Reject `--auth` without a credential file path instead of silently using the default credentials, and stop reading the next flag as the path.
