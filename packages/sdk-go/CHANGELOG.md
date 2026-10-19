# Changelog

## Unreleased

- Support optional completion callback URL and nonce parameters on spend-request creation, preserving returned approval and action URLs unchanged.
- Fix Go SDK compilation by adding the missing default spend request currency field.
- Preserve the stable Link user ID in user-info responses.
- Add optional idempotency keys to SpendRequest creation.
- Initial Go SDK implementation.
