# Next-action fixtures for engineering agent evaluation

This opt-in local command is for engineering evaluation harnesses. The controller
chooses the scenario; the evaluated agent presents the returned action through
its usual next-action presentation path. Normal payments continue to use
`spend-request create` and `spend-request retrieve <id> --next-action --format json`.
Never substitute simulation when a real payment fails.

```sh
link-cli next-action simulate --scenario ssn_verification --format json
link-cli next-action simulate --scenario partner_auth_challenge --format json
link-cli next-action simulate --scenario visa_otp --format json
link-cli next-action simulate --list-scenarios --format json
```

Choose exactly one of `--scenario` or `--list-scenarios`. IDs are case-sensitive.
`visa_otp` is the only alias and returns the `partner_auth_challenge` fixture;
SMS/email OTP details are not separate public action shapes. Unsupported flags
and positional arguments are rejected. No request ID, polling, URL overrides,
file export, test flag, or arbitrary fixture file loading is supported.

A selected scenario returns one framework-formatted item:

```json
[
  {
    "next_action": {
      "type": "ssn_verification",
      "resolution": "create_new_spend_request_after_completion",
      "display_message": "Additional identity verification is required. Please verify your SSN to continue.",
      "action_url": "https://example.invalid/link-simulation/finish_setup?verify=ssn_collection&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid",
      "expires_at": null
    }
  }
]
```

URLs preserve the current builders' route suffixes and query names under the
synthetic `/link-simulation` namespace: `/finish_setup` with `verify`, regional
parameters, `intended_email` and `fromEmail`; `/wallet` with `link_action` and
`spend_request_id`; and `/activity/approve/lsrq_simulation` for partner challenge
and enrollment. Both partner samples deliberately share the same URL, as a real
continuation can. Emails and request IDs are fixed synthetic inputs, with the
producer's form encoding preserved. The chosen legacy contact-support producer
returns the support-site root, represented by `/link-simulation/`; it does not
add an invented scenario path or a support article from a different producer.
Hosts remain synthetic because production hosts depend on account brand.
URL builders were checked at Mint `6c9007027432c3321bd1a3991fb7877e612eaeca`.

The stderr warning is separate from stdout. All URLs are synthetic under
`https://example.invalid/link-simulation/`; they cannot complete verification.
The command is stateless, deterministic, unauthenticated, offline, and excluded
from MCP tool discovery. It creates no request/session, sends no OTP, opens no
link, stores no data, and proves no approval, verification, or payment success.
Valid samples exit 0, including null actions and missing-scope actions.

## Catalog and provenance

The authoritative [local catalog](simulation-scenarios.ts)
and `--list-scenarios` provide 34 canonical descriptors in manifest order,
covering the 17 declared types, four resolutions, regional/pending variants,
message variants, and defensive controls. Alias IDs do not duplicate rows.
Descriptors give `scenario`, `type`, `resolution`, `url_kind`, `evidence_kind`,
`description`, `source_envelope`, and `aliases`; provenance never enters the
public `next_action` shape. The local schema intentionally covers more types
than the real SDK union without changing SDK responses or HTTP behavior.

`record_status_details` identifies persisted actions; their projected output
omits status. `error_next_action` identifies error-envelope origins, including
retry without delegated approval and additional scope. The scope producer uses
HTTP 403 and compacts nil URL/expiry fields; this sample preserves their absence
but does not emulate HTTP failure or claim retrieve currently projects it.
`documented_compatibility` identifies documented contracts, including partner
retry, for which no active constructor was verified. Current no-retry handling
can instead select/add a payment method. Regional pending samples are
`contract_variant`, not claims about current regional/account availability.
`synthetic_control` covers explicitly synthetic defensive/control cases.

## Presentation acceptance checks

- Present the exact complete returned URL and faithful message, preserving query
  strings/fragments. The harness checks clickability; do not construct a URL from
  the action type, decorate callbacks, browse, or complete the fixture action.
- For null/absent URLs, display the message and next step without inventing a link
  or saying there is no action. Pending verification is not completed verification.
- `auto_resume`: keep the same request; do not claim success or recreate solely
  because it is waiting.
- `create_new_spend_request`: follow the action instructions and describe creating
  a new request; do not keep polling an unusable request.
- `create_new_spend_request_after_completion`: describe user completion before a
  new request; pending/null-URL samples do not establish completion.
- `reauthorize_with_additional_scope`: describe obtaining the required scope;
  invent no auth URL and perform no real login/upgrade in this evaluation.
- Null overall action: invent no link, verification, approval, or payment success.
- Expired 3DS: do not promise the expired URL works. A real workflow would need a
  current response; this fixture evaluation must not trigger real retrieval.
- Null/unknown type: retain supplied URL/message rather than dropping the action.

Successive stateless samples can be selected by the harness, but do not validate
real lifecycle transitions. Run all 34 canonical IDs externally and record
pass/fail/not-run per scenario. CLI JSON tests alone do not establish agent URL
presentation reliability. No external presentation harness was run as part of
implementing these fixtures.

## Inventory refresh and release

Before merge, independently compare the backend next-action type and resolution
enums with the pinned inventory and independently maintained test expectations.
Recheck producer messages/pairings, serializer optional/null semantics, regional
requirements, and compatibility documentation. Update catalog, test counts,
provenance and this guide together; never infer live producer availability from
an enum declaration. Inventory was rechecked November 4, 2026 against Mint
`bad8deae738b9a5ee4e5a25c304ce646bfc10ebc`; messages were also checked at
`34139ea6536acd177c5ef0f47918cc1e20057bf9`.

Run catalog/handler tests, CLI typecheck/lint, build, compiled offline tests, and
real spend-request regressions. Use the ordinary reviewed CLI release pipeline;
no backend deploy, flags, migration, or SDK changes are needed. Rollback is a
CLI revert/release with no server or credential rollback.
