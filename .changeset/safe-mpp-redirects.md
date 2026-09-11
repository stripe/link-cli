---
'@stripe/link-cli': patch
---

Send MPP payment credentials only to the URL that returned the payment challenge.
Paid requests now reject redirects instead of forwarding credentials, and remote
MPP endpoints must use HTTPS. HTTP remains supported for exact loopback addresses
used in local development.
