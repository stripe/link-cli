---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
'@stripe/link-integrations-eve': minor
---

Add `link.mpp` to the SDK so agents can buy from sellers over the Machine Payment Protocol:
- `decode(request)` returns a URL's payment challenge
- `pay(request, { spendRequestId })` pays the challenge with a shared payment token from an approved spend request

The Eve extension adds matching `mpp_decode` and `mpp_pay` tools. `link-cli mpp pay` and `mpp decode` now call the SDK interfaces rather than implementing their own logic.

**Breaking:** `link-cli mpp pay` no longer accepts `--approved-challenge`. `mpp pay --spend-request-id` now pays the current challenge only if:
- its amount, currency, and network match the spend request
- it comes from the same origin as the request URL (same-origin redirects are followed)
