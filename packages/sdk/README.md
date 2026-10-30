# `@stripe/link-sdk`

Node.js SDK for agents that use Link. It provides typed resources for Link APIs
and accepts an access token from your application.

The SDK does not perform login, persist credentials, or own refresh tokens.
Authentication state and user-facing authorization flows belong to the CLI or
application embedding the SDK.

For services verifying credentials presented by agents, use the separate [Agent Identity SDK](../agent-identity/README.md). This package calls Link APIs on behalf of an agent.

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

Retrieve the approval policy for the current app and user:

```ts
const approvalPolicy = await link.approvalPolicy.retrieve();
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

## Agent tools

`@stripe/link-sdk/tools` exports `createLinkTools`, `linkToolSchemas`, and the
`LinkTools` / `LinkToolName` types. Each tool has a description, a Zod input
schema, and an executor that delegates to the existing SDK resources. This
entrypoint has no dependency on Eve or another agent framework.

```ts
import { Link } from '@stripe/link-sdk';
import { createLinkTools } from '@stripe/link-sdk/tools';

const tools = createLinkTools(new Link({ accessToken }));
const methods = await tools.list_payment_methods.execute({}, undefined);
```

For shared agents, pass a client resolver that receives your framework's
execution context. The resolver runs for each execution, never during tool
discovery:

```ts
const tools = createLinkTools((context: MyAuthenticatedContext) =>
  new Link({
    getAccessToken: (options) => credentials.getLinkToken(context.user, options),
  }),
);
```

Tool inputs use API field names and are validated before resolving the client.
The catalog includes wallet reads, spend-request operations, financial-data
reads, and purchase reports. Creating a spend request defaults to requesting
Link approval and returns immediately; the application handles approval URLs
and subsequent retrieval. Supply a stable `idempotency_key` when an executor can
be replayed.

For native Eve discovery, namespacing, access-token configuration, and replay handling, use
[`@stripe/link-integrations-eve`](../integrations/eve/README.md).

## User-approved purchase flow

Amounts are expressed in the currency's minor unit, such as cents for USD.

Omitting currency uses the consumer's default spend-request currency, reported by
`userinfo.default_spend_request_currency` (`user-info retrieve` in the CLI).
Specify currency explicitly when using an amount from a checkout with a known
currency. Amounts, line-item `unit_amount` values, and total `amount` values use
the selected currency's minor units: `100` means ¥100 in JPY or $1 in USD.
The client passes amounts through unchanged and performs no FX conversion.
This default applies to newly created requests; existing requests retain their
stored currency.

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
  case 'submitted':
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

## Completion callbacks

Pass optional `completion_callback_url` and `nonce` to `link.spendRequests.create()` or the `create_spend_request` agent tool.

Supply both fields or neither. Use an opaque, unpredictable nonce, save it
unchanged, and verify an exact match when the callback is received. The URL is
limited to 2,048 characters and the nonblank nonce to 512 JavaScript/UTF-16 code
units; the API validates live-mode HTTPS, URL security, and pair validity.
Use returned `approval_url` and `next_action.action_url` strings as-is. Do not
manually append callback parameters when creation-time context was supplied.
Retrieve the request to determine its status after a callback.

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

## Update payment methods

Pass `nickname`, `is_default`, or both to `paymentMethods.update`. An empty
nickname clears it; `is_default: true` sets the wallet default and replaces the
previous default, while `false` clears this method's default status. Omitted
fields stay unchanged.

```ts
await link.paymentMethods.update('pd_123', { is_default: true });
await link.paymentMethods.update('pd_123', { is_default: false });
await link.paymentMethods.update('pd_123', {
  nickname: 'Work card',
  is_default: true,
});
```

## Recurring payments

Pass `recurring` to `spendRequests.create` when the user has agreed to recurring
spending. For example, this requests a $20 monthly limit:

```ts
const request = await link.spendRequests.create({
  credential_type: 'card',
  merchant_name: 'Example Pro',
  merchant_url: 'https://example.com/subscribe',
  amount: 2000,
  currency: 'usd',
  context:
    'Monthly access to Example Pro requested by the user, with a spending limit of $20 per month including all taxes.',
  recurring: { interval: 'month' },
  request_approval: true,
});
```

Intervals are `day`, `week`, `month`, and `year`. Optional `interval_count` must
be a positive integer and defaults to `1` on the server; `{ interval: 'week',
interval_count: 2 }` resets the spending limit every two weeks. `amount` is the
limit per period. Omit `recurring` for a one-time purchase. The exported
`SpendRequestRecurringParams` type and `create_spend_request` agent tool use the
same input shape. Existing credential-type and merchant requirements still apply.

Follow the normal approval and retrieval flow. The merchant schedules charges.
Recurring card requests stay active after individual charges, so do not wait
for `succeeded` after each payment or create a new request each period. Respect
returned credential expiry values; confirm payments from the
merchant or transaction records. `update` cannot change the interval or count.
`cancel` revokes the payment credential but does not cancel the merchant's
subscription.

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

## UCP checkout

UCP checkout uses a business target and merchant item IDs. Quantity defaults to 1:

```ts
const checkout = await link.ucp.createCheckout({
  business: 'profile_example',
  line_items: [{ item: { id: 'sku_example' } }],
  buyer: { email: 'jane@example.com', phone_number: '+1234567890' },
});

const current = await link.ucp.retrieveCheckout(checkout.id, {
  business: 'profile_example',
});

const updated = await link.ucp.updateCheckout(checkout.id, {
  business: 'profile_example',
  buyer: { email: 'updated@example.com' },
});
```

Omit buyer or fulfillment during creation to use saved Link details. Review the returned messages, fulfillment choices, and totals. `updateCheckout(id, params)` uses PUT. Line items, buyer, and fulfillment are optional on update; omitted sections keep their existing checkout values. Updates do not reload saved Link wallet details. The seller determines currency; checkout requests do not accept `test` or `currency`.

When the checkout is ready, create and approve a spend request for the final total. `completeCheckout(id, { business, spend_request_id })` resolves its payment credential on the server. To inspect payment state as well as checkout state, pass `spend_request_id` to `retrieveCheckout`; the SDK fetches the spend request separately and attaches it as `spend_request`.

## Client resources

- `spendRequests` — create, approve, retrieve, update, cancel, and list
- `paymentMethods` — list, retrieve, and update Link payment methods
- `shippingAddresses` — list shipping addresses
- `userInfo` — retrieve Link user information, including the stable `id` when returned by the API
- `transactions` — list transactions
- `sources` — list connected sources
- `balances` — list balances
- `webBotAuth` — sign URLs for Web Bot Auth
- `reports` — report agent outcomes
- `ucp` — search the catalog and create, update, retrieve, and complete checkouts
