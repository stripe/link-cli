---
"@stripe/link-cli": patch
---

Allow eligible Link Pay Token spend requests to omit the merchant account ID and supply a merchant name, including delegated creation. Preserve the existing missing merchant ID error when the API rejects the request.
