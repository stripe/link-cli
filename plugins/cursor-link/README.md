# Link plugin for Cursor

Connects Cursor to a Link wallet through Link's hosted MCP server, so an agent
can complete purchases with one-time-use payment credentials that the user has
approved.

## Layout

```text
plugins/cursor-link/
├── .cursor-plugin/plugin.json   # Cursor manifest
├── .mcp.json                    # Hosted Link MCP server
├── assets/link.svg              # Plugin logo
└── skills/
    ├── complete-link-purchase/  # Buying flow
    └── check-link-wallet/       # Read-only wallet inspection
```

This directory is self-contained. It shares no files with `plugins/link/`,
which serves Claude and Codex and is built around the `link-cli` binary. The
two are intentionally separate: Cursor talks to a hosted MCP server and never
installs or invokes the CLI, so the guidance each client needs is different
enough that sharing skill text made both worse.

## Transport

Cursor reaches Link through `https://api.cursor.com/rest-mcp/stripe-link/mcp`.
Authentication is handled by Cursor's MCP OAuth flow. Users do not install
anything, and the skills here never shell out.

## Capability boundary

The hosted server exposes reads plus two non-spend writes:

`get_userinfo`, `list_spend_requests`, `get_spend_request`,
`list_payment_methods`, `list_shipping_addresses`, `sign_web_bot_auth`,
`report_agent_observation`.

**No tool on that server writes to a spend request**, by design rather than
omission: approval details attach at creation time, so whatever creates a
request defines what the user consents to, and that belongs to a human.

Spend approvals instead run through Cursor's own `request_virtual_card` tool,
which raises an approval card showing the amount, merchant, reason, and
itemized cart. The agent's turn ends there. Nothing is created unless the user
approves, and on approval they finish authorizing on Link's page and the agent
is resumed with the spend request id to poll. `complete-link-purchase` is
written around that handoff.

Transactions, balances, and funding sources are not yet reachable, so this
plugin ships no financial-insights skill. `plugins/link/` still covers that
ground for CLI-based clients.
