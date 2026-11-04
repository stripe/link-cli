---
"@stripe/link-cli": minor
"@stripe/link-sdk": major
---

Add `spend-request retrieve <id> --next-action --format json` to return one snapshot of the server's existing action, including actions on failed requests, or null. This mode does not poll or return payment credentials.

Correct TypeScript spend-request response types: status branches and their actions can be absent or null, action type can be null, and optional action expiry is a string or null rather than a number. Consumers must handle these nullable fields and string expiry. Add the existing `partner_create_card_enrollment` action type.
