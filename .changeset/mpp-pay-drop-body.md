---
"@stripe/link-cli": patch
---

security: `mpp pay` no longer returns the raw HTTP response body — the largest prompt-injection surface, since the body is fully merchant-controlled. Output is now `{ status, www_authenticate?, receipt?, receipt_error? }`. On success the merchant's `Payment-Receipt` header is parsed and validated against `mppx`'s strict `Receipt` schema (`method`, `reference`, `status`, `timestamp`); a missing header is not an error, and a malformed one is surfaced as a soft `receipt_error` while the successful `status` is still reported.
