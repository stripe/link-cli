---
'@stripe/link-sdk': minor
'@stripe/link-cli': patch
'@stripe/link-integrations-eve': minor
---

Expose Machine Payment Protocol helpers through `link.mpp` in the TypeScript SDK: `mpp.decode(request)` probes a URL and decodes a supported 402 challenge, and `mpp.pay(request, { spendRequestId })` re-verifies the fresh challenge against an approved spend request's terms and pays it with a shared payment token. `pay` requires the re-fetched challenge to be found at the same origin as `request.url`. Spend-request creation and approval remain on the existing `spendRequests` resource. `link-cli mpp pay` and `mpp decode` now run on top of these SDK methods, and the Eve extension gains matching `mpp_decode`/`mpp_pay` tools. `link-cli mpp pay` no longer accepts `--approved-challenge` — it was only ever used by generated continuation commands, which no longer pin a challenge.
