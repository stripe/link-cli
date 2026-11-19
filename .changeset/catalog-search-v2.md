---
"@stripe/link-sdk": minor
"@stripe/link-cli": minor
---

Update the supported catalog-search options in the CLI and TypeScript SDK.

- Remove `material`, `gender`, `availability`, and grouping options (CLI `--group-by` and SDK `group_by`).
- Restrict sort to `relevance`, `price_asc`, or `price_desc`, and condition to `new`, `used`, or `refurbished`.
- Require a supported lowercase currency code when either price bound is supplied, including zero. Amounts use the currency's minor units.

When upgrading, remove the deleted options from existing search requests and use the supported values. Free-text queries and exact-SKU filters (CLI `--id` and SDK `sku`) remain supported.
