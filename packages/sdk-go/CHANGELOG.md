# Changelog

## Unreleased

- Add `ApprovalPolicy.Retrieve`.
- Preserve an explicit empty `data` array when re-encoding an `Insight`.
- Add `PaymentMethods.Retrieve`, returning `nil` when the payment method does not exist.
- Add `Insights.ListAvailableTypes` and `Insights.List` for precomputed insights.
- Decode `BalanceDetails` on Link balance payment methods.
- Add `AttemptTrace` to report creation.
- Update payment methods' wallet default status independently or with nicknames.
- Add `partner_auth_challenge` and `partner_auth_challenge_retry` next action types.
- Support optional completion callback URL and nonce parameters on spend-request creation, preserving returned approval and action URLs unchanged.
- Fix Go SDK compilation by adding the missing default spend request currency field.
- Preserve the stable Link user ID in user-info responses.
- Add optional idempotency keys to SpendRequest creation.
- Initial Go SDK implementation.
