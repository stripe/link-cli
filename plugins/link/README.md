# Stripe Link — Cursor Plugin

This plugin lets Cursor agents get secure, one-time-use payment credentials from a [Link](https://link.com) wallet to complete purchases on your behalf.

## What's included

- **Skill** — `create-payment-credential`: step-by-step guide for authenticating, selecting credential type, creating a spend request, and completing payment
- **Agent** — `link-payment-agent`: pre-built Background Agent that runs the full payment flow end-to-end
- **MCP server** — auto-wires `@stripe/link-cli --mcp` so all Link tools are available as MCP tools

## MCP setup

The plugin's `mcp.json` registers the Link CLI as an MCP server:

```json
{
  "mcpServers": {
    "link": {
      "command": "npx",
      "args": ["@stripe/link-cli", "--mcp"]
    }
  }
}
```

No global install needed — `npx` fetches the CLI on first run.

## Requirements

- Node.js 18+
- A [Link account](https://link.com) with at least one saved payment method
