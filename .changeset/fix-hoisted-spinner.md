---
'@stripe/link-cli': patch
---

Bundle ink-spinner so interactive commands use the CLI's React and Ink instances, avoiding invalid hook calls when a Bun global install hoists the spinner alongside a different React version.
