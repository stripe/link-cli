---
'@stripe/link-cli': patch
---

Add a `link-balance` skill for paying with Link balance and using an approval policy to make purchases below the user's approval threshold without asking each time, for delayed, scheduled, unattended, or proactive purchases. Update the `create-payment-credential` and `link-cli` skills to point agents to it. Update the `--use-approval-policy` help text to say it requires a confidential OAuth client and isn't available with `link-cli auth login`.
