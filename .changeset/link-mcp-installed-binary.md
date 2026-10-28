---
'@stripe/link-cli': patch
---

The Link plugin and generated MCP server configurations now run the installed `link-cli` binary instead of resolving `@stripe/link-cli` through `npx`, `pnpx`, or `bunx` at startup, so an opened repository's `.npmrc` or `node_modules` can no longer choose the executable. Install the CLI with `npm install -g @stripe/link-cli` before using the plugin.
