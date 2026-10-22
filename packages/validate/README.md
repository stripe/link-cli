# Payment capability validation

`pnpm validate` starts a local server meant for builders to validate that their applications can correctly transact on the internet. For example, a personal shopping agent should be able to navigate to the test site and successfully pay it with a test-mode shared payment token (SPT). 

The validation site requires a Stripe sandbox key be set as `STRIPE_SECRET_KEY`. If it doesn't exist, copy your sandbox secret key from the [API keys](https://dashboard.stripe.com/test/apikeys) page of the Stripe Dashboard and set `STRIPE_SECRET_KEY`.

On link-cli 0.30.0 or later, the validator can automatically approve the test-mode spend requests for its seller. On older versions, a human must approve them in the browser or Link app.

## Instructions
The below instructions are written for coding agents (Claude Code, Codex, etc) running payment validations. In this example, we are building and validating a personal shopping agent. 

### Setup

Install the validator and its dependencies.
```sh
git clone https://github.com/stripe/link-cli
cd link-cli
pnpm install --prod --filter @stripe/link-validate
```

### Validate
Before evaluating the agent, confirm that it has all required integrations such as LLM access, agent wallet with SPT support, etc. 

If the agent's framework has a Link integration, prefer using that rather than rolling your own. For example, agents built on Eve should use [`@stripe/link-integrations-eve`](../integrations/eve).

Then, run the command.
```sh
pnpm validate
```

Run a subset with `pnpm validate --channel <channel>`; `pnpm validate --help` lists the channels. Some tasks need the agent to drive a real browser on this machine.

It will return `tasks`, which are prompts directing the shopping agent to your test seller. Feed each prompt to the agent verbatim, in its own conversation; tasks can run in any order or concurrently. The table shows progress and the number of validations passed. Only the overall `--timeout` limits the run. The validator exits on its own and outputs a report, whether or not the validation succeeds.

SPTs are one-time use. If you abandon a run, make sure to cancel any pending spend requests as cleanup.

### Notes
- Fix the agent to make the validation pass. Do not change the validator.
- Do not print API keys, sensitive tokens, or PII.
- The validator reads Link data with `link-cli`, so the agent must use the same Link login as `link-cli` on this machine.
