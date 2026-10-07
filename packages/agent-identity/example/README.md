# Agent Identity examples

These examples use the public `@stripe/agent-identity` exports. Build the package from the repository root with Node 24+ and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm --filter @stripe/agent-identity build
```

| Example | What it demonstrates | Run from the repository root |
| --- | --- | --- |
| [Credential verification](verify.mjs) | Verify an attestation and a verified-email presentation; reject a forgery and a wrong audience | `node packages/agent-identity/example/verify.mjs` |
| [Event registration](step-up/README.md) | Attestation for site access, an application session, verified email for registration, and safe retries | `node packages/agent-identity/example/step-up/demo.mjs` |
| [MCP integration guide](mcp/README.md) | Where to check credentials and handle challenges in an MCP HTTP transport | Integration guidance, not an executable server |

The fixture examples make no calls to Link and require no account. They print status messages without credentials or personal information. Expected output from `verify.mjs`:

```text
Valid Link attestation: accepted
Forged attestation: rejected
Verified email presentation: accepted
Wrong-audience presentation: rejected
```

For a real HTTP service with live public-key discovery and an agent using Link Agent Wallet, follow the [event-registration instructions](step-up/README.md#run-with-link-agent-wallet). The same service also runs with fixtures. It handles duplicate credential headers, JSON size limits, issuer failures, application sessions, and interaction expiry. Use its HTTP boundary as the reference when adapting the SDK to a framework.

Keep tokens and presentations in program memory or protected files. Parse wallet JSON output and send the proof directly through your HTTP client; do not manually transcribe proofs or put them in an agent transcript. The wallet identity commands are in beta.

The examples use the singular `example/` convention shared by the other integrations in this repository. For test fixtures and negative cases, see [testing your integration](../test/README.md).
