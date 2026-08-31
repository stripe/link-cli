---
name: link-cli
description: Install and authenticate Link CLI for agent payments, financial insights, or both. Use when a user is setting up Link CLI for the first time, asks to connect or log in to Link, or needs to configure Link access before using payment or financial-data features.
---

# Set up Link CLI

Set up and authenticate Link CLI for the user's intended use case. After setup, use the dedicated skill for payment or financial-insight work.

## 1. Determine the use case

Infer the use case only when the user's intent is explicit:

- **Agent payments**: buying, paying, checking out, or obtaining a payment credential.
- **Financial insights**: reading transactions, balances, connected accounts, or spending patterns.
- **Both**: enabling payments and financial insights.

If the intended use case is unclear, present **Both** first and explicitly recommend it as the default before installing, authenticating, or choosing permissions:

```text
How do you plan on using Link?
1. (Recommended) Both: agent payments and financial insights
2. Agent payments only
3. Financial insights only
```

If the user asks for the default, accepts the recommendation, or has no preference, select **Both**. Otherwise, do not proceed until the user chooses or otherwise clarifies their intention.

## 2. Check authentication first

Once the use case is known, run `auth status` as the first Link CLI command. Always do this before `auth login`, `auth upgrade`, or any payment or financial-data command:

```bash
link-cli auth status --format json
```

If `link-cli` is unavailable, install it with `npm install -g @stripe/link-cli`, then run the status command. Alternatively, replace `link-cli` in every command with `npx @stripe/link-cli@latest`.

### Common commands/options

- List all commands: `link-cli --llms`
- List all commands with parameters: `link-cli --llms-full`
- Get a command's exact schema with `--schema`. For example, `link-cli auth login --schema`
- Multi-step commands return a `_next` action. For example, authenticating returns a `_next.command` that must be run to complete the flow.
- By default all output is in `toon` format. Pass `--format [json|md|yaml]` to change output format.
- Some commands return a verification or approval URL. **These** must be presented to the user clearly for their action.
- `--auth <path>` flag to store auth credentials in a specific file instead of the default location. `auth login` writes to this file; all other commands read from it. Example: `link-cli auth login --auth credentials.json --format json`

_Recommended_: Run `link-cli --llms` to understand all the available commands. The `--llms-full` output is the canonical reference for parameter names, types, and valid values. Pass `--schema` before invoking a command to understand its parameters and constraints.

When present, inspect `scope` and `authorization_details` for the access required by the selected use case. Source actions appear in an authorization detail with `type: "source"`. If the response contains an `update` field, run its `update_command`, then check status again.

- If there is no active session, use `auth login`.
- If the active session already has the required access, do not start another authorization flow.
- Do not log out merely to add access. Leave broader existing access intact unless the user explicitly asks to replace it with narrower access.

If the user is already authenticated but you need broader access (an additional `scope`, `--source-actions`, or `--authorization-detail`), use `auth upgrade` instead of `auth login`. It takes the same flags but, rather than stopping with an "already logged in" message, merges what you request with the current `scope`/`authorization_details` and starts a new approval for the superset — so existing access is never dropped. Check `auth status` first so you know what's already granted. The current session stays valid during the approval and is only replaced once the user approves the new one, so an abandoned upgrade leaves the existing session working.

The token endpoint may omit `scope` or `authorization_details`, and environment-provided access tokens may not expose grant metadata. Do not claim unreported permissions are present. If a stored session's grants cannot be verified, use `auth upgrade` with the required access. Do not replace an environment-provided session without asking the user.

## 3. Request access for the use case

Use this access mapping:

| Use case | Scopes | Source actions |
|---|---|---|
| Agent payments only | `userinfo:read payment_methods.agentic` | None |
| Financial insights only | `userinfo:read` | Actions required for the requested insights |
| Both | `userinfo:read payment_methods.agentic` | Actions required for the requested insights |

Map financial-insight needs to source actions:

| Intended insight | Source action |
|---|---|
| Link-processed transactions | `read_link_transactions` |
| Transactions imported from connected banks | `read_external_transactions` |
| Account balances | `read_balances` |
| Connected source details and descriptions | `read_source_details` |

Request only the actions needed for a specific stated task. If the user asks to set up financial insights generally, request all four. For **both**, combine the agent-payment scopes with the applicable source actions.

Use `login` or `upgrade` based on the status result, a clear client name for the agent or application, and the scopes from the mapping:

```bash
link-cli auth login \
  --client-name "<your-agent-name>" \
  --scope "<selected-scopes>" \
  --format json
```

Replace `<your-agent-name>` with the name of your agent or application (for example, `"Personal Assistant"`, `"Shopping Bot"`). This name appears in the user's Link app when they approve the connection. Use a clear, unique, identifiable name.

Change `login` to `upgrade` when widening an active session. For financial insights, add one `--source-actions <action>` flag per required action. Do not pass placeholders literally.

## 4. Complete user approval

Authorization is a multi-step flow:

1. Present the returned `verification_url` and phrase clearly to the user.
2. Run the returned `_next.command` immediately to poll for approval; do not wait for another user reply before polling.
3. Continue only when the result reports successful authentication and the required grants.

The response includes a `_next` command — run it to poll until authenticated. If your environment cannot relay the verification code while a separate polling command blocks I/O, use inline polling instead by adding `--interval 5 --timeout 300` to the initial `auth login` or `auth upgrade` command. This yields the code immediately then polls in the same command.

DO NOT PROCEED until the user is authenticated with Link.

If approval is denied, expires, or times out, report that outcome. Do not repeatedly create new authorization flows without the user's direction. Never expose access tokens, refresh tokens, or authentication-file contents.

## 5. Hand off to the use-case skill

Authentication alone does not authorize an individual purchase and does not answer a financial-data question.

- For purchases and payment credentials, use the `create-payment-credential` skill.
- For transactions, balances, sources, and summaries, use the `financial-insights` skill.
- For users who selected both, load the relevant downstream skill for each subsequent task.
