# Next.js + Better Auth + Link

A localhost example using Link social sign-in, email/password authentication, and SQLite. Sign in with Link directly, or connect Link to an existing app user, then load its profile through Better Auth's native account API.

## Setup

```sh
pnpm install
cp .env.example .env.local
```

Fill out `.env.local` with your configuration

```dotenv
LINK_CLIENT_ID=your_client_id
LINK_CLIENT_SECRET=your_client_secret
STRIPE_PUBLISHABLE_KEY=your_publishable_key
```

## Run

Start the server

```sh
pnpm run dev
```

Open **http://localhost:3000** and choose **Continue with Link** to sign in or create an account. You can also sign in with email/password, then choose **Connect Link** to attach Link to that user.

The example registers `linkClient()` and uses `authClient.link.connect()` and
`authClient.link.disconnect()`. Disconnect revokes Link access before removing
the local account. Add another sign-in method before disconnecting your only one.
