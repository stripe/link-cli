---
'@stripe/link-sdk': minor
---

Add `createPresentation` for building identity-claims presentations from a Link-issued SD-JWT credential in Node.js, browsers, and edge runtimes. It is exported from the root entry and from `@stripe/link-sdk/presentation`, which has no Node.js dependencies. It accepts a `CryptoKey`, a private JWK, or a function returning either as the holder key, and throws `LinkPresentationError` with a typed `code` when a credential or holder key cannot be presented.
