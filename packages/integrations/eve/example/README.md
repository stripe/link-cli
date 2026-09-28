# Link + Eve example

Local terminal agent. Requires Node.js 24+ and pnpm.

Auth wiring is illustrative and assumes a single local user. Use your own
authentication and session integration when building your application.

From the repository root:

```sh
pnpm install
cd packages/integrations/eve/example
cp .env.example .env.local
```

Fill in `.env.local` with your OpenRouter API key, Link OAuth credentials, and
`BETTER_AUTH_SECRET` (generate once with `openssl rand -hex 32`).

Register `http://localhost:3000/api/auth/callback/link` as your Link OAuth redirect URI.

```sh
pnpm dev
```

Ask “List my payment methods.” Open the authorization link in your browser,
approve access, and return to the terminal.
