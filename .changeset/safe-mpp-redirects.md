---
'@stripe/link-cli': patch
---

Send MPP payment credentials only to the URL that returned the payment challenge.
Approved spend requests and paid retries now reject redirects instead of moving
credentials to a new destination. Remote MPP endpoints must use HTTPS; HTTP
remains supported for exact loopback addresses used in local development.
