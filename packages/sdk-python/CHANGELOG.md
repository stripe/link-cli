# Changelog

## Unreleased

- Preserve null credit usage in balance responses.
- Add `approval_policy.retrieve`.
- Add `payment_methods.retrieve`, the `insights` resource, payment-method `balance_details`, and report `attempt_trace`.
- Update payment methods' wallet default status independently or with nicknames.
- Add `partner_auth_challenge` and `partner_auth_challenge_retry` next action types.
- Refresh resolved dependencies, including Pydantic 2.14.1, and update Ruff to 0.17.1.
- Support optional completion callback URL and nonce parameters on spend-request creation, preserving returned approval and action URLs unchanged.

## 0.1.0

- Initial release of the typed synchronous and asynchronous Link API clients.
