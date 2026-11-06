---
'@stripe/link-cli': patch
---

Share in-flight refreshes of the same stored token so concurrent tool calls do not consume a rotating refresh token multiple times.
