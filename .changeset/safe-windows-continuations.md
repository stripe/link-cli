---
"@stripe/link-cli": patch
---

Omit dynamic shell command continuations on Windows and provide structured arguments for MPP, UCP, and spend-request polling. Retain explicitly POSIX-only compatibility strings elsewhere, quote UCP templates, and render Windows terminal suggestions as argument data. Consumers should invoke their trusted CLI entrypoint directly without a shell.
