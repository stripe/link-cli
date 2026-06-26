# @stripe/link-cli

## 0.8.2

### Patch Changes

- 1a0bf30: Make payment-method-id optional in spend-request create; if omitted, the default payment method will be used, or the first eligible one if no default is set

## 0.8.1

### Patch Changes

- dd0e303: Document the `report` command: add a "Report outcomes" section to the README and reporting guidance to the create-payment-credential skill, covering the outcome types (`success`, `blocked`, `abandoned`) and the tag reference. Reporting is described as optional.

## 0.8.0

### Minor Changes

- 5827e02: some improvemnts: Add --include-history flag to spend-request list; surface user eligibility in auth login and payment-methods list; add report command for agent observability; skip re-auth when a usable session already exists

## 0.7.4

### Patch Changes

- c2fc065: Added preapproved spendRequest

## 0.7.3

### Patch Changes

- f83d5cc: Update documented and enforced spend limits

## 0.7.2

### Patch Changes

- a30d70b: Update release.yml to upload SEA artifacts; update some min versions across configs

## 0.7.1

### Patch Changes

- 13fda7e: Update release workflow to upload built cli.js and checksum

## 0.7.0

### Minor Changes

- Auth cleanup && environment variables; Cursor plugin; Versions bump

## 0.6.0

### Minor Changes

- list prior spend requests, get user information

## 0.5.0

### Minor Changes

- 4121c7b: many improvements, bug fixes, and new abilities for shipping addresses and phone numbers

## 0.4.3

### Patch Changes

- 59a0fe1: Restrict the auth config file (`config.json`) to mode `0o600`. The file holds OAuth access + refresh tokens and, during a pending login, a `device_code`. Previously it inherited `conf`'s default (`0o666` masked by umask, typically `0o644`), which let other local users read the credentials and, during a login, race the legitimate poll loop to `/device/token`. Existing files are remediated automatically on the next config write.

## 0.4.2

### Patch Changes

- 90fc183: add claude marketplace.json and improve plugins

## 0.4.1

### Patch Changes

- 21bc584: Exit non-zero when spend request polling exhausts its timeout or max attempts before reaching a terminal status.
- 5e03819: bug-fixes

## 0.4.0

### Minor Changes

- a618ce2: fix-double-spend-request

## 0.3.1

### Patch Changes

- b061e10: Adds checklist flow to onboard/demo

## 0.3.0

### Minor Changes

- cd84685: adds new onboarding and demo flows that demonstrate how to use the link-cli

### Patch Changes

- facab3c: add mapping between cli commands and mcp tools to skill file

## 0.2.3

### Patch Changes

- de325f1: Polling commands now only emit results when the response has changed, reducing noise in agent logs.

## 0.2.2

### Patch Changes

- f8f51a6: Update plugin configs for claude and codex

## 0.2.1

### Patch Changes

- ef4e362: Fix bug with update-notifier

## 0.2.0

### Minor Changes

- eb2115d: Adds local stdio mcp server and agent-friendly formatting

### Patch Changes

- ae735ec: Use mpp to parse challenge directly
- ae735ec: Adds update-notifier and bug fixes

## 0.1.2

### Patch Changes

- ee734e7: Improve link-cli skill file

## 0.1.1

### Patch Changes

- 546d6ac: Updates build and publish settings to npm
