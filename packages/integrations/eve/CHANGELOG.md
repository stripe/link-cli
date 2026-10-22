# @stripe/link-integrations-eve

## 0.3.7

### Patch Changes

- Updated dependencies [c757edb]
  - @stripe/link-sdk@0.15.0

## 0.3.6

### Patch Changes

- 30256b7: Update runtime dependencies.
- Updated dependencies [b7a8e48]
- Updated dependencies [30256b7]
  - @stripe/link-sdk@0.14.2

## 0.3.5

### Patch Changes

- 4428004: Support the `partner_auth_challenge` and `partner_auth_challenge_retry` next actions. Interactive `spend-request create --request-approval` and `spend-request request-approval` now keep polling through any `auto_resume` action reached after approval instead of exiting, and agent-mode guidance for `auto_resume` no longer assumes 3D Secure.
- Updated dependencies [4428004]
  - @stripe/link-sdk@0.14.1

## 0.3.4

### Patch Changes

- 5adf7d9: Support recurring spend requests in public SDK inputs and agent tools. Document
  daily, weekly, monthly, and yearly spending limits, approval, expiry, and
  cancellation. Show recurring cadence in CLI spend request lists and update
  payment skills to handle recurring purchases.
- 88dc127: Add optional completion callback URL and nonce inputs to spend-request creation. CLI and agent tools require both or neither, validate URL and nonce limits, and preserve the supplied values unchanged. Returned approval and supported action URLs carry the backend-provided callback context; response parsing and polling behavior are unchanged.
- Updated dependencies [5adf7d9]
- Updated dependencies [88dc127]
  - @stripe/link-sdk@0.14.0

## 0.3.3

### Patch Changes

- 3b1340f: Update eve to 0.79.0 and the AI SDK dependency to ^7.0.137 in the extension and terminal OAuth example.

## 0.3.2

### Patch Changes

- a7b9528: Upgrade runtime dependencies to the latest compatible releases allowed by the workspace's seven-day release-age policy.
- Updated dependencies [a7b9528]
  - @stripe/link-sdk@0.13.2

## 0.3.1

### Patch Changes

- Updated dependencies [f64a291]
  - @stripe/link-sdk@0.13.0

## 0.3.0

### Minor Changes

- d4822cd: Make Link Pay Token a first-class spend request credential type. Create Link Pay Token requests with `credential_type: link_pay_token` and `merchant_account_id`.
  
  **Breaking:** the `--execution-method` CLI flag and the `execution_method` spend request parameter have been removed. Requests that used `execution_method: link_pay_token` with `credential_type: card` must switch to `credential_type: link_pay_token`.
- 4a9b116: Add `list_available_insight_types` and `list_insights` to the shared Link tool catalog and the Eve extension. The Eve financial-insights skill covers insight discovery, missing permissions, and pending or empty results.

### Patch Changes

- Updated dependencies [d4822cd]
- Updated dependencies [4a9b116]
- Updated dependencies [b7083b3]
  - @stripe/link-sdk@0.12.0

## 0.2.4

### Patch Changes

- 194a374: Upgrade the Eve extension compiler and example to Eve 0.66.3.

## 0.2.3

### Patch Changes

- Updated dependencies [000b1ad]
  - @stripe/link-sdk@0.11.0

## 0.2.2

### Patch Changes

- Updated dependencies [edaab73]
  - @stripe/link-sdk@0.10.0

## 0.2.1

### Patch Changes

- 208e3e0: Upgrades Eve version
- Updated dependencies [208e3e0]
  - @stripe/link-sdk@0.9.1

## 0.2.0

### Minor Changes

- 6eca012: Adds an integration for [Eve](https://eve.dev) via extension. `@stripe/link-sdk` now exports tools which integrations like Eve can import.

### Patch Changes

- Updated dependencies [6eca012]
  - @stripe/link-sdk@0.9.0
