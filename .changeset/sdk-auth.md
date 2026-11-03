---
'@stripe/link-sdk': minor
'@stripe/link-cli': patch
---

Move the reusable parts of Link sign-in — `LinkAuthResource` (device authorization, refresh, revocation), `createAccessTokenProvider`, scopes, authorization-detail helpers, and auth-specific types/errors — from `link-cli` into `@stripe/link-sdk`, so an app built on the SDK can sign a user in and keep a token fresh without copying CLI internals. `LinkAuthResource` now requires a `clientId` option (`link-cli` passes its own), so an SDK-based app can't silently pose as another OAuth client. `createAccessTokenProvider` now coalesces concurrent refreshes into a single `refreshToken` call, since Link rotates the refresh token on every use. `link-cli` is unchanged for users: it imports these from the SDK and keeps its own credential storage, login/upgrade commands, and exact user-facing messages.
