# Link for Better Auth

Sign in with Link or connect a Link wallet to an existing user. Better Auth manages OAuth, token storage, and refresh.

## Setup

Requires Node.js 22+ and Better Auth 1.7.5+.

```sh
pnpm add @stripe/link-integrations-better-auth better-auth
```

[Register a Link OAuth client](https://docs.stripe.com/agentic-commerce/link-cli/oauth) with the callback URL `https://yourapp.com/api/auth/callback/link`. Adjust the path if you use a custom Better Auth base path, and register any local development callback too.

Add the plugin to your server configuration:

```ts
import { betterAuth } from 'better-auth';
import { link } from '@stripe/link-integrations-better-auth';

export const auth = betterAuth({
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      trustedProviders: ['link'],
      // Allow the wallet email to differ from the app user's email.
      allowDifferentEmails: true,
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

Then register the client plugin:

```ts
import { linkClient } from '@stripe/link-integrations-better-auth/client';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [linkClient()] });
```

Default scopes are `payment_methods.agentic` and `userinfo:read`. For sign-in only, set `scopes: ['userinfo:read']` in `link(...)`. Keep `userinfo:read` when customizing scopes.

## Connect a wallet

After the user signs in to your app:

```ts
await authClient.link.connect({ callbackURL: '/settings' });
```

This starts Better Auth's OAuth linking flow and returns the user to `/settings` after authorization.

`connect` returns `{ data, error }` by default, even if the client uses global
`throw: true`. Pass `{ throw: true }` as the second argument to receive data
directly and throw on errors.

## Disconnect a wallet

Find the connected account and pass its Better Auth record ID:

```ts
const { data: accounts, error } = await authClient.listAccounts();
if (error) throw new Error(error.message);

const account = accounts?.find((account) => account.providerId === 'link');
if (account) {
  const { error } = await authClient.link.disconnect({ accountId: account.id });
  if (error) throw new Error(error.message);
}
```

Disconnect requires a fresh session and protects the user's last sign-in method by default. It revokes Link access before deleting the local account; failed revocation keeps the connection intact for retry.

Use `account.id` for account operations. `account.accountId` is the stable Link user ID.

## Sign in with Link

To let users sign in or create an app account with Link:

```ts
await authClient.signIn.social({
  provider: 'link',
  callbackURL: '/dashboard',
});
```

Better Auth's account-linking and email-verification policies apply. Use `authClient.accountInfo()` for the connected profile and server-side `auth.api.getAccessToken()` for Link API calls.

## Example

See the [Next.js example](example/README.md) for a runnable app with sign-in, wallet connection, and disconnect.
