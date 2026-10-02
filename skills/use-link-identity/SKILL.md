---
name: use-link-identity
description: Use Link CLI's identity commands when a service requests a Link Agent Attestation Token (AAT) or signed user claims such as email. Covers acquiring and managing attestations, obtaining identity credentials, and presenting selected claims to a verifier through an HTTP client or browser automation.
allowed-tools:
  - Bash(link-cli:*)
  - Bash(npx --yes @stripe/link-cli:*)
  - Bash(npm install -g @stripe/link-cli:*)
license: Complete terms at https://github.com/stripe/link-cli/blob/main/LICENSE
metadata:
  author: stripe
  url: link.com/agents
---

# Link identity

These commands are in **beta**. Use them when a service accepts Link attestations or signed user claims.

| Service requests | Command | JSON field → HTTP header |
|---|---|---|
| A Link Agent Attestation Token (AAT), often via `WWW-Authenticate: PrivateToken` | `identity attestations take` | `authorization` → `Authorization` |
| Signed claims, often via `WWW-Authenticate: Identity-Presentation` | `identity credentials present` | `presentation` → `Identity-Presentation` |

An AAT proves issuance by Link without disclosing user claims. A presentation discloses selected claims and proves possession of the credential's holder key for an audience and nonce. If the service requires both, send both headers.

## Setup and handling

For installation and authentication, reuse the [create-payment-credential skill](https://github.com/stripe/link-cli/blob/main/skills/create-payment-credential/SKILL.md)'s shared guidance.

- Identity commands are available through the CLI, not its MCP tools.
- Only `request` needs Link authentication. `list`, `take`, and `present` use local files. Requests return paths and metadata; `take` and `present` return proofs.
- Capture stdout with `--format json`, parse it programmatically with a JSON parser or `jq`, and pass the exact proof to the HTTP client or browser automation. **Never manually transcribe, reconstruct, or re-encode tokens or presentations.** Keep proofs, private keys, and claim values out of transcripts and logs; use restrictive permissions for handoff files.
- Cached identity files belong to the home directory. Changing `--auth` or logging in as another user does not switch the cached identity. Use separate home directories for different users.

## Attestations

```bash
# Inspect inventory.
link-cli identity attestations list --format json

# Refill only when needed. Count is required: 1–100.
link-cli identity attestations request --count 10 --format json

# Take a token when ready to use it.
link-cli identity attestations take --format json
```

Check `errors` and `attestations`. Only entries with `storage: "pool"` are available to `take`; `total_token_count` also includes exports. Requests append to `~/.link-cli/attestations/pool.json`.

Example `take` output:

```json
{
  "issuer": "https://api.link.com",
  "token_key_id": "<issuer-key-id>",
  "token": "<token>",
  "authorization": "PrivateToken token=\"<token-with-header-padding>\""
}
```

Use `authorization` verbatim, including its scheme and quoting. `take` removes the token locally; server reuse rules belong to the service. Keep the same AAT for retries tied to an existing interaction, and use a fresh one for a new service. Do not return taken tokens to the pool.

For agent-managed allocation, export a batch instead:

```bash
link-cli identity attestations request --count 10 --output-file ./aats.json --format json
```

Use a new file outside `~/.link-cli/attestations`. Read its `tokens` array and each entry's `authorization` programmatically. Exported tokens never enter the CLI pool; the caller owns allocation, concurrency, and cleanup.

## Credentials and presentations

```bash
# Check errors, expired, expires_at, and claim_names.
link-cli identity credentials list --format json

# Request only if no usable credential exists for the intended user.
link-cli identity credentials request --format json
```

Issuance replaces `~/.link-cli/credentials/current.json` and creates or reuses `~/.link/holder-key.jwk`. Keep both local. Choose claims with `present`:

```bash
link-cli identity credentials present \
  --aud 'https://service.example' \
  --nonce '<nonce-from-challenge>' \
  --claim email \
  --format json
```

Use the service challenge's exact audience and nonce after checking that they belong to the intended service. All three options are required. Repeat `--claim` only for additional requested claims authorized by the user's task. Pass challenge values as individual process arguments or quote them safely in a shell.

Example output:

```json
{"presentation":"<issuer-jwt>~<email-disclosure>~<key-binding-jwt>"}
```

`present` signs locally with the saved holder key and leaves the files unchanged. Send the presentation promptly. Reuse the underlying credential until expiry, but obtain a fresh challenge after a nonce is consumed or expires.

## Send and recover

Set headers only for the intended endpoint. Preserve the challenged operation's method, body, session, interaction identifiers, and any required AAT. Avoid global browser headers or redirects that forward proofs to another origin. Report success only after the service accepts the request.

- `ATTESTATION_POOL_EMPTY`: request a batch, then take a token.
- Errors in `list`: inspect the reported file/error instead of treating storage as empty.
- Unavailable claim: check `claim_names`; do not disclose extra claims or the raw credential.
- Missing or mismatched holder key: preserve the files and restore the correct key or explicitly obtain a new credential.
- Audience or nonce rejection: check the intended service and its current challenge before presenting again.
