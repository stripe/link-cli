---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
'@stripe/link-integrations-eve': patch
---

Restore the optional `eligible_for_balance` boolean in user info, reverting its removal in #494. The TypeScript SDK and CLI preserve both `true` and `false` and leave the field absent when the API omits it. CLI terminal output again displays balance eligibility when present.

Restore balance-eligibility guidance in the Eve integration's payment skill.
