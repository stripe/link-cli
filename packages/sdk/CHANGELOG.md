# @stripe/link-sdk

## 3.1.0

### Minor Changes

- ea1d9d1: Restore the optional `eligible_for_balance` boolean in user info, reverting its removal in #494. The TypeScript SDK and CLI preserve both `true` and `false` and leave the field absent when the API omits it. CLI terminal output again displays balance eligibility when present.
  
  Restore balance-eligibility guidance in the Eve integration's payment skill.

## 3.0.0

### Major Changes

- ae48c5e: Remove the deprecated `exp_month` and `exp_year` fields from saved payment-method `CardDetails`. Consumers should use `brand` and `last4` to identify saved cards. Additional API fields continue to pass through at runtime.
  
  SpendRequest `card` credentials retain `exp_month` and `exp_year` for checkout.

## 2.2.0

### Minor Changes

- fa6d4c1: Align UCP checkout commands and SDK types with the UCP checkout schema, covering creation, retrieval, completion, updates, and cancellation.
  
  UCP commands show an interactive summary in a terminal without an explicit format. Use `--format json` for the full response, including checkout messages, fulfillment choices, and capability metadata. Piped output and MCP remain structured.
  
  Checkout summaries display buyer details, selected fulfillment destinations and options with labeled method, destination, group, and option IDs, and UCP messages with error codes, severity, field paths, and recovery URLs. Missing buyer details, destinations, or selections are shown explicitly.
  
  - `checkout create` requires `--business` and at least one `--line-item` with an `id` and optional positive integer `quantity` (default 1). Buyer and fulfillment are optional.
  - `checkout retrieve` requires a checkout ID and `--business`.
  - `checkout complete` requires a positional checkout ID, `--business`, and an approved `--spend-request-id` for the same business, and returns the completion API response.
  - `checkout update` requires a checkout ID and `--business`. Line items, buyer, and fulfillment are optional.
  - Add `checkout cancel`, which requires a checkout ID and `--business` and returns the canceled checkout.
  
  Retrieve, update, and cancel accept the checkout ID positionally or through `--id`. `--buyer` accepts optional `first_name`, `last_name`, `email`, and `phone_number` fields. `--fulfillment` (also spelled `--fullfilment`) accepts the entire fulfillment object as JSON. The seller determines currency. Responses use UCP statuses, `totals`, `line_items`, and `order`, with `expires_at` as an RFC 3339 timestamp.
  
  Omitted fulfillment during creation uses a complete saved default shipping address when available.

## 2.1.0

### Minor Changes

- 9537851: Add `use_approval_policy` to `create_spend_request` and a `retrieve_approval_policy` tool, letting SDK and Eve agents create policy-approved spend requests and read the configured approval policy — the same balance-backed flow `link-cli` already supports.

## 2.0.0

### Major Changes

- 6489245: Add `spend-request retrieve <id> --next-action --format json` to return one snapshot of the server's existing action, including actions on failed requests, or null. This mode does not poll or return payment credentials.
  
  Correct TypeScript spend-request response types: status branches and their actions can be absent or null, action type can be null, and optional action expiry is a string or null rather than a number. Consumers must handle these nullable fields and string expiry. Add the existing `partner_create_card_enrollment` action type.

### Minor Changes

- 5d4eb12: Expose spend request `expires_at` in the public SDK and agent tools. Document
  expiry limits and delayed merchant charges in CLI help and purchase guides.
  The CLI, TypeScript SDK and tools, and Python SDK accept Unix seconds or ISO
  8601 expiry timestamps ending in `Z` (UTC) and convert ISO input to Unix seconds
  for the API.
  
  Convert spend-request `expires_at` responses from API Unix seconds to ISO 8601
  timestamps ending in `Z` (UTC) in the CLI and all SDKs.

## 1.0.0

### Major Changes

- b76e268: Remove balance eligibility from user info. The TypeScript SDK no longer exposes `eligible_for_balance`, the Go SDK no longer exposes `EligibleForBalance`, and CLI JSON and interactive output omit the field even when the server still returns it.

## 0.15.0

### Minor Changes

- c757edb: Add `test-helpers spend-request approve <id>` to approve pending demo spend requests. Enable with `LINK_TEST_HELPERS=1` or `true`.
  
  Export `BaseResource` so CLI-owned resources can reuse SDK request handling.

## 0.14.2

### Patch Changes

- b7a8e48: Support setting and clearing the wallet default payment method independently or together with a nickname update.
- 30256b7: Update runtime dependencies.

## 0.14.1

### Patch Changes

- 4428004: Support the `partner_auth_challenge` and `partner_auth_challenge_retry` next actions. Interactive `spend-request create --request-approval` and `spend-request request-approval` now keep polling through any `auto_resume` action reached after approval instead of exiting, and agent-mode guidance for `auto_resume` no longer assumes 3D Secure.

## 0.14.0

### Minor Changes

- 5adf7d9: Support recurring spend requests in public SDK inputs and agent tools. Document
  daily, weekly, monthly, and yearly spending limits, approval, expiry, and
  cancellation. Show recurring cadence in CLI spend request lists and update
  payment skills to handle recurring purchases.
- 88dc127: Add optional completion callback URL and nonce inputs to spend-request creation. CLI and agent tools require both or neither, validate URL and nonce limits, and preserve the supplied values unchanged. Returned approval and supported action URLs carry the backend-provided callback context; response parsing and polling behavior are unchanged.

## 0.13.3

### Patch Changes

- 770d411: Use the backend's consumer default spend-request currency when currency is omitted from CLI or SDK agent-tool creation, instead of injecting USD. Explicit currency values still override the default. Amounts pass through unchanged in the selected currency's minor units; specify currency explicitly for checkout amounts with a known currency. Existing spend requests retain their stored currency.
  
  Correct CLI spend-request list formatting for currencies such as JPY.

## 0.13.2

### Patch Changes

- a7b9528: Upgrade runtime dependencies to the latest compatible releases allowed by the workspace's seven-day release-age policy.

## 0.13.1

### Patch Changes

- 979d2d8: Handle sparse addresses across link-cli and python sdk from userinfo command

## 0.13.0

### Minor Changes

- f64a291: Ungating identity commands, now in beta.

## 0.12.0

### Minor Changes

- d4822cd: Make Link Pay Token a first-class spend request credential type. Create Link Pay Token requests with `credential_type: link_pay_token` and `merchant_account_id`.
  
  **Breaking:** the `--execution-method` CLI flag and the `execution_method` spend request parameter have been removed. Requests that used `execution_method: link_pay_token` with `credential_type: card` must switch to `credential_type: link_pay_token`.
- 4a9b116: Add `list_available_insight_types` and `list_insights` to the shared Link tool catalog and the Eve extension. The Eve financial-insights skill covers insight discovery, missing permissions, and pending or empty results.

### Patch Changes

- b7083b3: Accept and display Canadian Agent Wallet verification statuses returned by user-info retrieve.

## 0.11.0

### Minor Changes

- 000b1ad: Spend requests now include their recurring terms (`recurring.interval` and `recurring.interval_count`) when set, and interactive spend request output shows them.

## 0.10.0

### Minor Changes

- edaab73: Add `insights list-available-types` and `insights list` for discovering and retrieving Link financial insights.

## 0.9.1

### Patch Changes

- 208e3e0: Upgrades Eve version

## 0.9.0

### Minor Changes

- 6eca012: Adds an integration for [Eve](https://eve.dev) via extension. `@stripe/link-sdk` now exports tools which integrations like Eve can import.

## 0.8.0

### Minor Changes

- dab0fcd: Add the `approval-policy retrieve` CLI command and the SDK approval policy resource.
- 4b85448: Add better-auth integration and include `id` in userinfo.
- 2e5dae2: Add payment-method nickname updates to the CLI and SDKs. An empty nickname clears the existing nickname.
- 8a5d13a: Add `payment-methods retrieve` to the CLI and payment-method retrieval to the TypeScript SDK.
- 4e5da73: Temporarily remove the `/summaries` feature. It will return as `/insights`.

### Patch Changes

- aa6bd92: Support Link balance details returned by the payment methods list API.

## 0.7.0

### Minor Changes

- c31bfd2: Add UCP catalog search and checkout creation, completion, and retrieval to the CLI and SDK, including checkout status polling in the CLI.

### Patch Changes

- 09b8b1f: Expose the user address and balance eligibility returned by `user-info retrieve`.

## 0.6.0

### Minor Changes

- c1f35ec: Add support for listing financial insight summaries through the CLI and SDK.

## 0.5.0

### Minor Changes

- 835e7bb: feat: Handle the new Submitted SpendRequest state

### Patch Changes

- 835e7bb: Support the `submitted` spend request status. Retrieve polling now waits for
  the initial waiting status to change, returning immediately for submitted and
  unknown statuses instead of relying on a list of terminal statuses.

## 0.4.2

### Patch Changes

- 0991a1d: Dependency upgrades

## 0.4.1

### Patch Changes

- ac17965: Add caller-supplied idempotency keys to SpendRequest creation.

## 0.4.0

### Minor Changes

- c6464e3: Add `--attempt-trace` to `link-cli report` (and `attempt_trace` to the SDK's `CreateReportParams`): a step-by-step account of the path the agent took on a domain, written so another agent could follow it. Sent for successes and failures alike — the dead ends on a failed attempt are the useful part. The API truncates past 8000 characters rather than rejecting, so the flag carries no client-side length limit.

## 0.3.2

### Patch Changes

- 1fe657f: Rename the Agent Wallet user-info step-up field to `agent_wallet_verification_requirement` and expose its nullable `action_url`.

## 0.3.1

### Patch Changes

- ca643dc: Expose Agent Wallet spend limits and user step-up status through user-info retrieve.

## 0.3.0

### Minor Changes

- ec7fc04: Support incremental auth workflows; refine UCP command; Do not render approval qr code for delegated spend requests; Document email-prefilled Link URLs- #287

## 0.2.1

### Patch Changes

- a1c6872: Fix: allow nickname to be undefined in shipping address resource

## 0.2.0

### Minor Changes

- 8ee4dea: Publish the Link SDK.
