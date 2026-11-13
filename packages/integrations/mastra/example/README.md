# Link + Mastra Studio example

A local, single-user Link wallet agent in Mastra Studio. Requires Node.js 24+, pnpm,
a Link access token, and a model provider API key. No Mastra cloud account is needed.
Studio and its SQLite database run locally; model and Link calls use external services.
The example pins TypeScript 6 because Mastra's CLI tooling does not yet support
the workspace's TypeScript 7 compiler.

From the repository root:

```sh
pnpm install
cd packages/integrations/mastra/example
cp .env.example .env
```

Set `LINK_ACCESS_TOKEN` to a token obtained by your application through
[Link OAuth](https://docs.stripe.com/agentic-commerce/link-cli/oauth).
The example does not implement login or read CLI credentials.

The default model is `openrouter/openai/gpt-6-luna`; set `OPENROUTER_API_KEY`.
Alternatively, change `MASTRA_MODEL` and supply that provider's API key.
Keep the Link token in `.env`, not in chat or Studio's request-context editor.

```sh
pnpm dev
```

This builds the integration and SDK, then starts Studio at
<http://localhost:4111>. Select **Link Wallet** in **Agents** and start a chat:

- “List my payment methods.”
- “What are my current balances?”
- “Which brands do I buy most often?”

Financial queries require suitable scopes and source permissions on your token.
The agent explains missing access; it cannot grant itself additional permissions.

To try spend confirmation, explicitly request a test card credential, providing the
merchant name, URL, amount, and purchase details. Studio pauses before
`create_spend_request` and shows approval controls. Declining makes no Link request.
Approving runs the tool, which may return a separate Link approval URL. Complete
Link's flow and ask the agent to retrieve the same request. Mastra confirmation
does not substitute for Link authorization. This example has no merchant checkout tools.

Use agent chat to exercise confirmation. Studio's standalone tool runner directly
executes tools and does not provide the agent's approval gate.

Local libSQL storage retains conversation history and approval snapshots. Generated
`.mastra/` files, databases, and `.env` are ignored by Git. All users of this local
example share the configured wallet; the server binds to localhost. For an
application with multiple users, use the package's `getAccessToken` resolver with
your authenticated server context instead.

Stop the server with Ctrl-C. A stale token produces an authentication error; update
the token in `.env` and restart.
