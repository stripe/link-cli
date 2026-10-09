---
'@stripe/link-cli': patch
---

Prevent Bun from automatically starting an HTTP server after CLI commands finish by removing the CLI entrypoint's default fetch-bearing export. Explicit HTTP serving remains available through `serve`.
