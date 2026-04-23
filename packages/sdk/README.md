# `@stripe/link-sdk`

Node SDK for Link API interactions.

## Install

```bash
npm install @stripe/link-sdk
```

## Quick Start

```ts
import Link from '@stripe/link-sdk';

const link = new Link();

const paymentMethods = await link.paymentMethods.list();
console.log(paymentMethods[0]?.id);
```

## Authentication

The SDK uses device auth.

```ts
import Link from '@stripe/link-sdk';

const link = new Link();

const auth = await link.auth.initiateDeviceAuth();
console.log(auth.verification_url_complete);

let tokens = null;
while (!tokens) {
  await new Promise((resolve) => setTimeout(resolve, auth.interval * 1000));
  tokens = await link.auth.pollDeviceAuth(auth.device_code);
}
```

By default, auth state is stored on disk. To keep auth in memory instead:

```ts
import Link, { MemoryStorage } from '@stripe/link-sdk';

const link = new Link({
  authStorage: new MemoryStorage(),
});
```

## Spend Requests

```ts
const spendRequest = await link.spendRequests.create({
  payment_details: 'pd_123',
  merchant_name: 'Acme',
  merchant_url: 'https://acme.com',
  context: 'Purchasing a user-approved item from acme.com.',
});

const approval = await link.spendRequests.requestApproval(spendRequest.id);
console.log(approval.approval_link);
```

## Configuration

```ts
const link = new Link({
  fetch,
  verbose: true,
  authBaseUrl: 'https://login.link.com',
  apiBaseUrl: 'https://api.link.com',
  spendRequestBaseUrl: 'https://api.link.com',
});
```

## Errors

The SDK throws typed errors:

- `LinkConfigurationError`
- `LinkAuthenticationError`
- `LinkTransportError`
- `LinkApiError`

## Notes

- Requires Node.js 18+.
