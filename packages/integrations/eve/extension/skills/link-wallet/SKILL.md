---
name: link-wallet
description: Use the configured Link wallet to inspect payment methods, balances, transactions, and spend requests, or obtain payment credentials for a purchase or checkout.
---

# Link wallet

Use this extension's discovered tools with their mount prefix, such as
`link__create_spend_request`. The application configures the access token and
wallet. Never ask the user for a token in chat or start a CLI login. If a tool
reports an invalid or expired token, ask the application operator to configure a
new token; the extension does not refresh it automatically.

## Inspect the wallet

Use `retrieve_user_info` for the profile, spend limits, and verification
requirements. Use `list_payment_methods` if the user wants a particular payment
method; otherwise omit `payment_details` to use the default. Use
`list_shipping_addresses` when shipping details are needed. Financial data is
available through `list_balances`, `list_sources`, and `list_transactions` when
the configured token has the required permissions. Missing fields do not imply
unlimited spending or completed verification.

## Create and approve a purchase

1. Inspect the merchant's checkout and confirm the final total, currency, items,
   and shipping costs before creating a request. Amounts are in cents. Supply
   an accurate purchase rationale in `context` (at least 100 characters).
2. Choose `credential_type: card` for a card form, or `shared_payment_token` for a
   supported Stripe machine payment flow, supplying its `network_id`. For Link
   Pay Token checkout, use `execution_method: link_pay_token` with card
   credentials and the `merchant_account_id` read from
   `data-stripe-merchant-account` in the merchant's checkout DOM. Do not invent
   the merchant account ID or supply merchant name/URL, network ID, or test mode
   for that execution method.
3. Call `create_spend_request`. By default, Eve requires user approval before
   every call; follow the application's configured Eve approval policy.
   Leave `request_approval` at its default, `true`, to request Link approval too.
   Setting it to `false` defers requesting Link approval; it does not grant
   purchase authorization. Use this only to prepare a draft, then call
   `request_spend_approval` when it is ready. Eve approval does not replace Link
   authorization.
4. Present the returned approval URL to the user. Creation returns immediately;
   use `retrieve_spend_request` with the same ID to check the current status.
   Never treat a created or pending request as approved. For `requires_action`,
   show `status_details.requires_action.next_action.display_message` and
   `action_url`. If its `resolution` is `auto_resume`, retrieve the same request
   again after the action; otherwise have the user complete the action before
   creating a new request. Do not use credentials from a canceled, expired,
   rejected, or otherwise unusable request.
5. Retrieve credentials only when needed for the approved checkout (for a card,
   use `include: ['card']`). Send them only to the intended checkout, never in
   conversational replies. Report the actual purchase outcome with
   `create_report`; do not claim a purchase succeeded merely because credentials
   were issued.

Use `list_spend_requests` to find existing requests, `update_spend_request` to
correct a request when its status allows it, and `cancel_spend_request` to cancel
an abandoned purchase. Reuse an `idempotency_key` only when retrying the same
logical creation. Use `test: true` only for an explicitly requested test flow.

## Handle credentials

Card numbers, security codes, and payment tokens are sensitive. Do not repeat
them in chat, reports, or purchase context. Tool results can appear in the
application's stored events, so request credentials only when checkout needs
them. A tool failure is not evidence that payment succeeded; verify the request
and merchant outcome before retrying a purchase.
