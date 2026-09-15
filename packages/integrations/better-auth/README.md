# Link for Better Auth

Connect Link to a signed-in app user through Better Auth's native social account APIs. Configure `link(...)`, then use `linkSocial`, `listAccounts`, `getAccessToken`, and `unlinkAccount`.

## Setup

Requires Node.js 22+ and Better Auth 1.7.5+.

```sh
pnpm add @stripe/link-integrations-better-auth better-auth
```

[Register a confidential Link OAuth client](https://docs.stripe.com/agentic-commerce/link-cli/oauth) with the callback URL `https://yourapp.com/api/auth/callback/link`. For local development, use `http://localhost:3000/api/auth/callback/link`. Adjust `/api/auth` if you use a custom Better Auth base path.

```ts
import { betterAuth } from 'better-auth';
import { link } from '@stripe/link-integrations-better-auth';

export const auth = betterAuth({
  account: {
    accountLinking: {
      trustedProviders: ['link'],
    },
  },
  plugins: [
    link({
      clientId: process.env.LINK_CLIENT_ID!,
      clientSecret: process.env.LINK_CLIENT_SECRET!,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
    }),
  ],
});
```

## Connect and use Link

Use your existing Better Auth client. After the user signs in to your application:

```ts
await authClient.linkSocial({
  provider: 'link',
  callbackURL: '/settings',
});
```

## Local Next.js example

See [example/](example/README.md) for a runnable Next.js app with email/password
sign-in, SQLite, and Link connection. Set the required credentials in the example's
`.env.local` first, then run from the repository root:

```sh
pnpm --dir packages/integrations/better-auth/example dev
```
