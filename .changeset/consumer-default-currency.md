---
"@stripe/link-cli": patch
"@stripe/link-sdk": patch
---

Use the backend's consumer default spend-request currency when currency is omitted from CLI or SDK agent-tool creation, instead of injecting USD. Explicit currency values still override the default. Amounts pass through unchanged in the selected currency's minor units; specify currency explicitly for checkout amounts with a known currency. Existing spend requests retain their stored currency.

Correct CLI spend-request list formatting for currencies such as JPY.
