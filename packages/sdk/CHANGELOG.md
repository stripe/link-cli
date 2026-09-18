# @stripe/link-sdk

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
