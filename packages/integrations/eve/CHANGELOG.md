# @stripe/link-integrations-eve

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
