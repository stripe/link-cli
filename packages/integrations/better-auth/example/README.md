# Next.js + Better Auth + Link

A localhost example using email/password authentication and SQLite. After signing in, connect Link and load its user profile through Better Auth's native account API.

## Run

Requires Node.js 22.13+ and pnpm. From the repository root:

```sh
pnpm install
cp packages/integrations/better-auth/example/.env.example packages/integrations/better-auth/example/.env.local
```

Fill in **all three required values** in `.env.local`: `LINK_CLIENT_ID`,
`LINK_CLIENT_SECRET`, and `STRIPE_PUBLISHABLE_KEY`. The development and production
servers fail at startup if any value is missing, empty, or whitespace-only.
Register this callback with your confidential Link OAuth client:

```text
http://localhost:3000/api/auth/callback/link
```

Start the example from the repository root:

```sh
pnpm --dir packages/integrations/better-auth/example dev
```

Open **http://localhost:3000**, create an account, and sign in. The integration package builds automatically before the dev server starts. SQLite initializes automatically in `example.sqlite`; no database service, migration command, or other social provider is needed.

Click **Connect Link** after signing in. After approving access, **Load Link profile** calls Link's userinfo API through Better Auth. **Disconnect Link** revokes access and unlinks the account.

The example permits the Link email to differ from the app's login email. Link email is used as the provider account ID; if it changes, unlink the old account before reconnecting. All credentials are read on the server, and OAuth tokens use Better Auth's encrypted account storage.

## Files

- `lib/auth.ts`: email/password auth, SQLite initialization, and `link(...)` configuration.
- `app/api/auth/[...all]/route.ts`: Better Auth's standard Next.js handler.
- `app/page.tsx`: native sign-in, account-linking, profile, and unlink calls.

This example binds to loopback and includes a local development secret. It is intended for localhost use. SQLite and `.env.local` are ignored by Git. To reset it, stop the server and remove `example.sqlite` and any SQLite companion files.
