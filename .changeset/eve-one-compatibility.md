---
'@stripe/link-integrations-eve': minor
---

Prepare the extension for Eve 1.0 by rebuilding with `eve@1.0.0-rc.5` and
requiring Eve `^1.0.0-rc.5`. Eve 0.x is no longer supported; upgrade the agent
and extension together and rebuild the agent. Update the terminal OAuth example
and approval tests for the 1.0 APIs, and document credential ownership and
remembered approval decisions.
