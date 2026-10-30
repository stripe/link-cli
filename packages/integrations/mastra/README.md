# Link for Mastra

Native Link wallet tools for [Mastra](https://mastra.ai/), backed by
`@stripe/link-sdk/tools`. Requires Node.js 24+ and `@mastra/core` 1.74.0 or later
in the 1.x series. Tested with 1.74.0.

## Install

```sh
pnpm add @stripe/link-integrations-mastra @mastra/core
```

```ts
import { Agent } from '@mastra/core/agent';
import {
  createLinkTools,
  linkSkillsPath,
} from '@stripe/link-integrations-mastra';

export const agent = new Agent({
  id: 'link-agent',
  name: 'Link Wallet',
  model: process.env.MASTRA_MODEL!,
  instructions: 'Help the user with their wallet.',
  tools: createLinkTools({ accessToken: process.env.LINK_ACCESS_TOKEN! }),
  skills: [linkSkillsPath],
});
```

Set `MASTRA_MODEL` to a Mastra model identifier and configure its provider API key.
Keep `LINK_ACCESS_TOKEN` in the server environment. Every call with a static token
uses that token's wallet and permissions, regardless of who is chatting with the
agent. The integration does not read CLI credentials, start OAuth, or refresh tokens.

Creating a spend request requires Mastra confirmation by default. Configure
storage and approval handling as described below, or use the complete
[local Studio example](example/README.md).

## Authentication

Configure exactly one of `accessToken` or `getAccessToken`. Static tokens must be
nonempty. For applications serving multiple users, resolve the token on each call:

```ts
const tools = createLinkTools({
  getAccessToken: async (context) => {
    const userId = context?.requestContext?.get('authenticatedUserId');
    if (typeof userId !== 'string') throw new Error('Sign in first.');
    // Application-owned lookup, including refresh when needed.
    return loadOrRefreshLinkToken(userId);
  },
});
```

Populate `authenticatedUserId` from your server's verified session before invoking
the agent. Do not trust a caller-supplied user ID from Studio or an HTTP request body
as proof of identity. The resolver receives Mastra's tool execution context; it can
also access the abort signal and agent/workflow metadata when available.

Tokens are resolved only during execution, never when discovering or registering
tools. Resuming an approved call resolves the token again; pass the current trusted
`requestContext` when approving. The package does not cache tokens or clients across
calls. Resolvers may be synchronous or asynchronous and must return a nonempty
token. Resolver errors propagate without a Link request.

Your application owns OAuth consent, token storage, refresh, and reconnection. A
Link 401 fails once with an instruction to configure a valid token, without exposing
the response body or retrying the request. Other SDK errors propagate unchanged.
See [Link OAuth](https://docs.stripe.com/agentic-commerce/link-cli/oauth) for grant setup.

## Tools and skills

The returned map uses the same names as the SDK, without a mount prefix:

| Tools | Purpose |
| --- | --- |
| `retrieve_user_info` | Profile, limits, and verification requirements |
| `list_payment_methods`, `list_shipping_addresses` | Saved wallet details |
| `list_spend_requests`, `create_spend_request`, `retrieve_spend_request`, `update_spend_request` | Purchase requests and their status |
| `request_spend_approval`, `cancel_spend_request` | Request approval or cancel a request |
| `list_transactions`, `list_sources`, `list_balances` | Authorized financial data |
| `list_available_insight_types`, `list_insights` | Discover and retrieve computed insights |
| `create_report` | Record a purchase attempt's outcome |

Inputs retain SDK/API names such as `payment_details`, `line_items`, and `id` for
spend-request lookup. Results are unchanged SDK responses. Mastra returns its normal
validation-error result for invalid input before resolving credentials.

The package ships two [Agent Skills](https://agentskills.io) in its `skills/`
directory, adapted from Link's wallet skills:

| Skill | Covers |
| --- | --- |
| `create-payment-credential` | Spend requests, approval, `requires_action`, credentials, and reports |
| `financial-insights` | Transactions, balances, sources, insights, and pagination |

Add the exported `linkSkillsPath` to the agent's `skills`, as shown above. Mastra
lists each skill's name and description in the system message and gives the agent
`skill`, `skill_read`, and `skill_search` tools to load the full instructions on
demand. Keep your own agent-specific guidance in `instructions`.

To share the skills through a [workspace](https://mastra.ai/docs/sandbox/skills)
instead, add the path to its `skills` and allow the filesystem to read it:

```ts
import { LocalFilesystem, Workspace } from '@mastra/core/workspace';
import { linkSkillsPath } from '@stripe/link-integrations-mastra';

export const workspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: './workspace',
    allowedPaths: [linkSkillsPath],
  }),
  skills: ['skills', linkSkillsPath],
});
```

The skills load from the installed package at runtime, so deployments must keep
the package's `skills/` directory alongside its `dist/` output. An agent-level skill
with the same name overrides a workspace skill.

Select tools normally when the agent only needs a subset:

```ts
const link = createLinkTools({ accessToken: process.env.LINK_ACCESS_TOKEN! });
const tools = {
  list_balances: link.list_balances,
  list_transactions: link.list_transactions,
};
```

The package exports `LinkToolsOptions` and `LinkTools` types. Each native Mastra
`Tool` retains its SDK input and output types without adding response schemas.

Financial-data tools require the appropriate scopes and source permissions. Insight
results with `status: 'no_data'` and `error_code: 'missing_permissions'` remain data,
including `authorization_remediation`; they do not trigger authentication or widen
the grant. Insights require the Link API release serving `/insights` and
`/insights/available_types`.

Tool output can include payment credentials, private financial data, and shopping
patterns in the model context and stored transcript. Applications control access
and retention. The skills tell the agent to summarize financial data and not
repeat credentials in conversational replies.

## Spend confirmation

`create_spend_request` sets Mastra's `requireApproval: true`, including when
`request_approval: false` prepares a draft. Other tools do not require Mastra
confirmation by default. Applications can disable this tool-level requirement:

```ts
const tools = createLinkTools({
  accessToken: process.env.LINK_ACCESS_TOKEN!,
  requireSpendApproval: false,
});
```

An agent-level `requireToolApproval` setting can still require confirmation.
Mastra enforces confirmation through its agent runtime; directly calling a tool's
`execute` method does not prompt for approval.

For confirmation pauses, configure a storage provider on your `Mastra` instance.
For local development, install `@mastra/libsql` and use:

```ts
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';

export const mastra = new Mastra({
  agents: { agent },
  storage: new LibSQLStore({ id: 'local', url: 'file:./link.db' }),
});
```

Studio presents approval controls in agent chat. In a custom client, consume
`tool-call-approval` events, show the user the tool arguments, then call
`agent.approveToolCall({ runId, toolCallId, requestContext })` or
`agent.declineToolCall({ runId, toolCallId, requestContext })`. Consume the resumed
stream as well, including any further approval events. See Mastra's
[human-in-the-loop guide](https://mastra.ai/docs/agents/human-in-the-loop).

Mastra confirmation is separate from Link purchase authorization. Spend requests
default to `request_approval: true` and return immediately. Show `approval_url`, then
retrieve the same request after approval. Follow
`status_details.requires_action.next_action` when further action is needed.
Preparing a draft or confirming the Mastra tool call does not authorize a purchase.

## Development

From the repository root:

```sh
pnpm turbo run build --filter=@stripe/link-integrations-mastra...
pnpm --filter @stripe/link-integrations-mastra typecheck
pnpm --filter @stripe/link-integrations-mastra test
pnpm --filter @stripe/link-integrations-mastra-example typecheck
```

Tests use mocked Link responses and a deterministic model, including real Mastra
approval/resume with local in-memory storage. They need no credentials or paid API calls.
