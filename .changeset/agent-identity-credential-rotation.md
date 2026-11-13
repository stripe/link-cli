---
'@stripe/agent-identity': patch
---

Refetch the credential JWKS when no cached key verifies an identity presentation, so credentials signed after Link rotates its signing key verify immediately instead of failing with `issuer JWT signature does not verify` until the one-hour cache expires. The refetch runs at most once every 30 seconds per JWKS URI, concurrent requests share one fetch, and a failed refetch keeps the cached keys. `CredentialFixture.create()` accepts a `kid` option for minting credentials under a rotated key.
