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

Create `agent/extensions/link.ts`:

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

The extension accepts the token directly. It does not start OAuth, read CLI
credentials, require a user principal, or refresh the token. A 401 fails once
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
| `create_report` | Record a purchase attempt's outcome |

Inputs use SDK/API field names, such as `payment_details`, `line_items`, and
`spend_request_id`. Financial-data tools may require additional scopes and source
permissions on the supplied token. CLI-only actions,
device login, delegated approval, and identity attestations are not exposed.

By default, `create_spend_request` requires Eve user approval on every call
(`always()`). Applications can [override this policy](#override-or-remove-a-tool).
Spend requests also default to requesting Link approval and return immediately.
Setting `request_approval: false` intentionally supports preparing a draft before
calling `request_spend_approval`; it does not authorize the purchase. Show the
approval URL to the user and retrieve the same request after approval. Follow
`status_details.requires_action.next_action` when further action is required.
Eve approval is separate from Link's purchase authorization.

Tool results are normal SDK responses. Requesting `include: ['card']` can return
payment credentials in Eve's tool output and stored events. The extension's
instructions tell the agent not to repeat them in conversation; applications
still control who can access the transcript and how results are retained.

## Wallet skill

The extension includes a custom
[`link-wallet` skill](extension/skills/link-wallet/SKILL.md) covering the mounted
tools, configured token, purchase approval, and credential handling. Edit it
directly in this package. Eve bundles it with the extension; no CLI skill syncing
or separate CLI login is required.

## Future interactive OAuth

This version accepts an access token. Eve's
[self-hosted interactive OAuth](https://eve.dev/docs/connections#self-hosted-interactive-oauth)
provides a native path for adding OAuth later, without Better Auth:

- `defineInteractiveAuthorization` supplies `getToken`, `startAuthorization`,
  and `completeAuthorization`. Eve handles its callback route, consent events,
  suspending the turn, and resuming after authorization.
- The same provider works in SDK-backed tools through `ctx.getToken(provider)`;
  a separate MCP or OpenAPI connection is not required. On a rejected bearer,
  `ctx.requireAuth(provider)` invalidates Eve's cache and restarts authorization.
- A Link provider would handle PKCE, OAuth state validation, code exchange,
  persistent token storage, refresh, and revoked grants. Tokens must be scoped
  to the authenticated principal, and the callback must satisfy Link's registered
  redirect-URI requirements. Eve's per-step token cache is not a durable grant store.

An extension can also contribute actual MCP/OpenAPI connections under
`extension/connections/` and use that provider for their `auth`. Interactive auth
requires an authenticated user on the consuming agent's channel.

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
