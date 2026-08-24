# `@stripe/link-sdk`

Node.js SDK for agents that use Link. It provides typed resources for Link APIs
and accepts an access token from your application.

The SDK does not perform login, persist credentials, or own refresh tokens.
Authentication state and user-facing authorization flows belong to the CLI or
application embedding the SDK.

## Install

```bash
npm install @stripe/link-sdk
```

The package is ESM-only and requires Node.js 20 or newer.

## Quick start

Pass an access token when creating the client:

```ts
import Link from '@stripe/link-sdk';

const link = new Link({ accessToken: process.env.LINK_ACCESS_TOKEN! });

const paymentMethods = await link.paymentMethods.list();
```

Use a fixed token for a short-lived job or when the caller replaces the entire
client as credentials change.

## Credentials

Exactly one credential option is required.

### Dynamic access tokens

When your application manages expiring credentials, provide `getAccessToken`.
The SDK calls it for each request. After a 401 response, the SDK calls it once
with `forceRefresh: true` and retries the request with the returned token.

```ts
const link = new Link({
  getAccessToken: async ({ forceRefresh } = {}) =>
    credentialManager.getLinkAccessToken({ forceRefresh }),
});
```

The credential manager should coalesce concurrent refreshes if several
requests can receive a 401 at the same time. A client configured with a fixed
`accessToken` does not retry a 401 because it cannot obtain a different token.

## User-approved purchase flow

Amounts are expressed in the currency's minor unit, such as cents for USD.
`context` must be at least 100 characters and should tell the user what the
agent is buying and why.

```ts
const methods = await link.paymentMethods.list();
const paymentMethod = methods.find((method) => method.is_default) ?? methods[0];

if (!paymentMethod) {
  throw new Error('The user needs to add a Link payment method.');
}

const spendRequest = await link.spendRequests.create({
  payment_details: paymentMethod.id,
  credential_type: 'card',
  amount: 2599,
  currency: 'usd',
  merchant_name: 'Acme',
  merchant_url: 'https://acme.example',
  context:
    'The user asked the agent to buy the selected item from Acme for $25.99, including the displayed shipping cost.',
});

const approval = await link.spendRequests.requestApproval(spendRequest.id);
await sendToUser(`Approve this purchase: ${approval.approval_url}`);
await saveRunState({ spendRequestId: spendRequest.id });
```

Retrieve the request in a later agent run:

```ts
const result = await link.spendRequests.retrieve(state.spendRequestId);

if (!result) {
  throw new Error('Spend request not found.');
}

switch (result.status) {
  case 'approved':
    // Use the returned credential without placing it in logs or chat.
    break;
  case 'created':
    return { status: 'approval_not_requested' };
  case 'pending_approval':
    return { status: 'waiting_for_user_approval' };
  case 'requires_action': {
    const action = result.status_details?.requires_action?.next_action;
    return action?.resolution === 'auto_resume'
      ? { status: 'retry_later' }
      : action;
  }
  case 'denied':
  case 'expired':
  case 'succeeded':
  case 'failed':
  case 'canceled':
    return { status: result.status };
}
```

Only a `requires_action` result whose `resolution` is `auto_resume` should be
polled automatically. For any other resolution, surface the action to the user
and follow its instructions. Keep returned card or shared-payment-token
credentials out of model context, logs, and user-visible messages.

## Configuration

```ts
const link = new Link({
  accessToken,
  fetch,
  defaultHeaders: { 'X-Agent-Version': 'acme-agent/1.0' },
  verbose: true,
  logger: { debug: (message) => diagnostics.debug(message) },
  apiBaseUrl: 'https://api.link.com',
  spendRequestBaseUrl: 'https://api.link.com',
});
```

Verbose logging includes request methods, URLs, and response status codes. It
does not include authorization headers or request and response bodies.

## Errors

The SDK throws typed errors:

- `LinkConfigurationError` for invalid or missing client configuration
- `LinkTransportError` when a request cannot reach Link
- `LinkApiError` for non-success API responses
- `LinkResponseError` when a successful response has an invalid shape

`LinkApiError` includes `status`, `code`, and structured `details` fields for
programmatic handling.

```ts
import { LinkApiError } from '@stripe/link-sdk';

try {
  await link.spendRequests.retrieve('spend_request_id');
} catch (error) {
  if (error instanceof LinkApiError) {
    diagnostics.error({
      status: error.status,
      code: error.code,
      details: error.details,
    });
  }
  throw error;
}
```

## Client resources

- `spendRequests` — create, approve, retrieve, update, cancel, and list
- `paymentMethods` — list Link payment methods
- `shippingAddresses` — list shipping addresses
- `userInfo` — retrieve Link user information
- `transactions` — list transactions
- `sources` — list connected sources
- `balances` — list balances
- `webBotAuth` — sign URLs for Web Bot Auth
- `reports` — report agent outcomes
