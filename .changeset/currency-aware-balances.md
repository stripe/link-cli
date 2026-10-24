---
'@stripe/link-cli': patch
---

`balances list` now uses currency-aware amount formatting instead of a hardcoded `$` and `/100`, which rendered zero- and three-decimal currencies 100x or 10x off.
