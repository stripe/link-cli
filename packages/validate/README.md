# Payment capability validation

`pnpm validate` starts a local server meant for builders to validate that their applications can correctly transact on the internet. For example, a personal shopping agent should be able to navigate to the test site and successfully pay it with a test-mode shared payment token (SPT). 

The validation site requires a Stripe sandbox key. It uses an existing Stripe sandbox key or prints instructions to set one up if none exists.

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

When using the Link Agent Wallet for SPT creation, a human is required to approve spend requests. Confirm that a human is available before starting, and give them the URLs to approve test-mode spend requests in their browser or in the Link app.

Then, run the command.
```sh
pnpm validate
```

It will return a `task` which is a prompt directing the shopping agent to your test seller. Feed the prompt to the agent verbatim and let it work. The validator exits on its own and outputs a report, whether or not the validation succeeds.

Each run of the validator waits for one SPT transaction and its confirmation before reporting success, and SPTs are one-time use. If you abandon a run, make sure to cancel any pending spend requests as cleanup.

### Notes
- Fix the agent to make the validation pass. Do not change the validator.
- Do not print API keys, sensitive tokens, or PII.
