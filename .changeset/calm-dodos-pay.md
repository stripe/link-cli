---
'@stripe/link-sdk': minor
'@stripe/link-cli': minor
'@stripe/link-integrations-eve': minor
'@stripe/link-integrations-mastra': minor
---

Add `link.mpp` to the SDK so agents can buy from sellers over the Machine Payment Protocol:
- `decode(request)` returns a URL's payment challenge
- `pay(request, { spendRequestId, approvedChallenge })` pays the challenge with a shared payment token from an approved spend request, refusing a challenge whose terms changed since `decode`

The Eve extension adds matching `mpp_decode` and `mpp_pay` tools. `link-cli mpp pay` and `mpp decode` now call the SDK interfaces rather than implementing their own logic.

`link-cli mpp pay` now also checks the re-fetched challenge's amount, currency, and network against the spend request, and follows same-origin redirects when re-fetching it.
