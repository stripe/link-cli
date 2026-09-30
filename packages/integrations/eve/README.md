# Link for Eve

Use a Link wallet from an [Eve extension](https://eve.dev/docs/extensions).
Tools reuse `@stripe/link-sdk/tools`; the extension adds Eve discovery
and an Eve-specific wallet skill.

Requires Node.js 24+. Built with Eve 0.54.4; Eve checks the generated extension
compatibility metadata when a consumer builds.

## Install and mount

```sh
pnpm add @stripe/link-integrations-eve
```

Configure either a static access token or an [OAuth provider](#interactive-oauth).
For a static token, create `agent/extensions/link.ts`:

```ts
import link from '@stripe/link-integrations-eve';

export default link({
  accessToken: process.env.LINK_ACCESS_TOKEN!,
});
```

Set `LINK_ACCESS_TOKEN` in your agent's server environment, such as `.env.local`
for local development. The token is required and must be nonempty. Every tool
call through this mount uses that token's wallet and permissions, regardless of
the Eve session's caller. Control access to the agent accordingly.

Static-token mode does not start OAuth, read CLI credentials, require a user
principal, or refresh the token. A 401 fails once
with an instruction to configure a new token. Tokens are configuration, never
model-supplied tool arguments.

## Tools

Mounting as `link` adds the `link__` prefix to these names:

| Tools | Purpose |
| --- | --- |
| `retrieve_user_info` | Profile, limits, and verification requirements |
| `list_payment_methods`, `list_shipping_addresses` | Saved wallet details |
| `list_spend_requests`, `create_spend_request`, `retrieve_spend_request`, `update_spend_request` | Purchase requests and their status |
| `request_spend_approval`, `cancel_spend_request` | Request approval or cancel a request |
| `list_transactions`, `list_sources`, `list_balances` | Financial data permitted by the user's OAuth grant |
| `list_available_insight_types` | Discover insight types and any `authorization_remediation` each needs |
| `list_insights` | Computed insight results by ID, with `ready`, `pending`, or `no_data` status |
| `create_report` | Record a purchase attempt's outcome |

Inputs use SDK/API field names, such as `payment_details`, `line_items`, and
`spend_request_id`. Financial-data tools may require additional scopes and source
permissions on the supplied token.

By default, `create_spend_request` requires Eve user approval on every call
(`always()`). Applications can [override this policy](#override-or-remove-a-tool).
Spend requests also default to requesting Link approval and return immediately.
Setting `request_approval: false` intentionally supports preparing a draft before
calling `request_spend_approval`; it does not authorize the purchase. Show the
approval URL to the user and retrieve the same request after approval. Follow
`status_details.requires_action.next_action` when further action is required.
Eve approval is separate from Link's purchase authorization.

Tool results are normal SDK responses. Requesting `include: ['card']` can return
payment credentials in Eve's tool output and stored events. Financial-data and
insight tools return private transaction history, balances, and inferred
shopping patterns in the same way. The extension's instructions tell the agent
not to repeat credentials and to summarize financial data; applications still
control who can access the transcript and how results are retained.

`list_insights` reports insufficient access as a result (`status: no_data`,
`error_code: missing_permissions`, plus `authorization_remediation`), not as a
401. The extension does not widen the grant itself; your authorization provider
decides whether and how to request the listed access. These tools require the
Link API release that serves `/insights` and `/insights/available_types`.

## Skills

The extension includes [`create-payment-credential`](extension/skills/create-payment-credential/SKILL.md)
and [`financial-insights`](extension/skills/financial-insights/SKILL.md).
They adapt the root skills' guidance to native tool calls and Eve authorization.
Edit these copies directly and keep shared wallet behavior aligned with the root
skills. Eve bundles both under the extension's mount prefix.

## Interactive OAuth

Pass an application-owned Eve authorization provider as `auth` in
`agent/extensions/link.ts`:

```ts
import link from '@stripe/link-integrations-eve';
import { linkAuth } from '../lib/link-auth';

export default link({ auth: linkAuth });
```

Implement `linkAuth` in your application with Eve's
[`defineInteractiveAuthorization`](https://eve.dev/docs/connections#self-hosted-interactive-oauth).
It takes three methods:

- `getToken`: load or refresh the current principal's token; throw
  `ConnectionAuthorizationRequiredError` when consent is needed.
- `startAuthorization`: return the Link consent URL and any serializable state
  needed to finish authorization.
- `completeAuthorization`: validate the callback, exchange the code, persist the
  grant, and return `{ token, expiresAt }` (expiration is milliseconds since epoch).

The extension calls `ctx.getToken(auth)` before a Link API call and
`ctx.requireAuth(auth)` when Link returns 401. Eve presents the authorization
challenge, suspends the turn, and resumes it after authorization. Interactive
providers require an authenticated user on the consuming agent's inbound channel.

Your provider owns Link's PKCE/state validation, token exchange, persistent
per-user grants, refresh, and revocation. Link requires an exactly registered
redirect URI; your application's callback routing must connect that URL to Eve's
per-attempt callback. See [Link's OAuth documentation](https://docs.stripe.com/agentic-commerce/link-cli/oauth)
and [Eve's lifecycle fixture](https://github.com/vercel/eve/blob/main/e2e/fixtures/agent-tools-hitl/agent/tools/auth-probe.ts).
The fixture uses a test token; it demonstrates the lifecycle, not a Link OAuth client.

Configure exactly one of `accessToken` or `auth`. The extension also accepts
Eve's `getToken`-only providers when your application already manages authorization.
Vercel Connect is not required.

## Override or remove a tool

Use Eve's standard directory mount and overrides:

```text
agent/extensions/link/
  extension.ts
  tools/create_spend_request.ts
```

To remove a tool:

```ts
import { disableTool } from 'eve/tools';

export default disableTool();
```

To disable Eve's confirmation prompt for this tool, create
`agent/extensions/link/tools/create_spend_request.ts`:

```ts
import { create_spend_request } from '@stripe/link-integrations-eve/tools';
import { defineTool } from 'eve/tools';
import { never } from 'eve/tools/approval';

export default defineTool({ ...create_spend_request, approval: never() });
```

Use `once()` to prompt once per session, or supply a custom approval policy.
These overrides control Eve's confirmation prompt; Link's purchase authorization
remains separate.

## Terminal example

See the [terminal OAuth example](example/README.md) for an agent scaffolded with
Eve's CLI that connects our Better Auth Link integration to the mounted extension.

## Development

From the repository root:

```sh
pnpm --filter @stripe/link-integrations-eve... build
pnpm --filter @stripe/link-integrations-eve typecheck
pnpm --filter @stripe/link-integrations-eve test
```

`eve extension build` emits the extension, mount factory, tool exports, and
compatibility manifest under `dist/`. The Eve runtime is a peer dependency;
the exact development dependency pins the compiler. The normal workspace build
builds the SDK first. Publish the built package, including `dist/`.
