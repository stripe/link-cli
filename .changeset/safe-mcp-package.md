---
'@stripe/link-cli': patch
---

Register the MCP server with its standalone executable when applicable, or the
detected package runner and versioned `@stripe/link-cli` package. Existing MCP
registrations are not updated automatically; rerun `link-cli mcp add` after
upgrading to replace the generated `link-cli` entry.
