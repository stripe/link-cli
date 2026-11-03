---
"@stripe/link-sdk": minor
"@stripe/link-cli": patch
"@stripe/link-integrations-eve": patch
---

Expose spend request `expires_at` in the public SDK and agent tools. Document
expiry limits and delayed merchant charges in CLI help and purchase guides.
The CLI, TypeScript SDK and tools, and Python SDK accept Unix seconds or ISO
8601 expiry timestamps ending in `Z` (UTC) and convert ISO input to Unix seconds
for the API.
