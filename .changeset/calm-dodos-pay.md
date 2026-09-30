---
'@stripe/link-sdk': minor
'@stripe/link-cli': patch
---

Expose Machine Payment Protocol helpers through `link.mpp` in the TypeScript SDK. The SDK can decode supported challenges into an extensible array and safely submit payment from an approved spend request ID; spend-request creation and approval remain on the existing `spendRequests` resource.
