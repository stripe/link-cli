---
"@stripe/link-cli": minor
---

security: `serve` now binds to `127.0.0.1` by default (opt out with `--host`), only serves the `/mcp` endpoint and skills discovery (all other paths 404 instead of reaching the CLI command router), and validates request `Origin` instead of sending wildcard CORS. This prevents an unauthenticated HTTP caller that can reach the port from invoking the CLI owner's authenticated Link session.
