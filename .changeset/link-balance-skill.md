---
'@stripe/link-cli': patch
---

Add a `link-balance` skill for paying with Link balance and using an approval policy to make purchases below the user's approval threshold without asking each time, for delayed, scheduled, unattended, or proactive purchases. Update the `create-payment-credential` and `link-cli` skills to point agents to it. Agents check `eligible_for_balance` from `user-info retrieve` before offering Link balance setup. Update the `--use-approval-policy` help text to say it requires your own Link OAuth client ID.
