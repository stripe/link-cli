---
'@stripe/link-cli': patch
---

Harden HTTP serve routing by validating and dispatching the same parsed request
URL. Reject ambiguous request paths with a bad-request response, restrict MCP
to POST requests, and limit skill discovery to its supported GET endpoints.
Malformed request targets no longer terminate the server.
