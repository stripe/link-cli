---
"@stripe/link-cli": minor
"@stripe/link-sdk": minor
"@stripe/link-integrations-eve": minor
---

Make Link Pay Token a first-class spend request credential type. Create Link Pay Token requests with `credential_type: link_pay_token` and `merchant_account_id`.

**Breaking:** the `--execution-method` CLI flag and the `execution_method` spend request parameter have been removed. Requests that used `execution_method: link_pay_token` with `credential_type: card` must switch to `credential_type: link_pay_token`.
