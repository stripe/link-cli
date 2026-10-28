# Link Balance integration guide

**Note:** Some specific flags and query parameters might change names prior to this feature going live in production.

**Note:** We need to turn on a feature flag for your OAuth client before your agent can access these features. Please let us know when you’re ready for us to flag you in.

## Overview

Link balance is a payment method that lets users hold money in their Link account. It can be used like any other payment method in link-cli, but it can also be used to enable agents to make purchases without requesting approval.

This unlocks several new use cases for agentic spending, for example:

* **Approve now, buy later.** "Grab these sneakers when my size is back in stock." The user agrees once, and your agent buys whenever the condition is met.  
* **Buy at a specific time.** "Get two tickets when they go on sale at midnight." The purchase happens on time, even if the user is busy or away from their devices.  
* **Repeated purchases on a schedule.** "Reorder dog food every month from the store with the cheapest price." Each order goes through on schedule, even if the merchant changes.  
* **Fewer interruptions.** For any kind of purchase, some users would prefer to reduce friction and let their agent spend without requesting approval each time.
* **Proactive purchases.** If the user wants it, your agent can buy things on its own initiative, based on the user's instructions or preferences, without being asked each time. The skill files tell agents to do this only when they know the user wants it, to start with small purchases, and to tell the user after every one.

Link balance does not support link-cli's recurring payments (`--recurring-interval`). Those are for merchant subscriptions, where the merchant keeps one card on file and charges it each period, such as a software subscription. Repeated purchases with Link balance are separate one-time spend requests, so each one can go to a different merchant.

## Setup

### Skill files

Make sure your agent has access to the latest skill files for link-cli, including the new skill file for Link balance. If your agent uses custom skill files, incorporate the key information in these skills into your agent’s custom skills.

Latest skill files: [`link-cli`](link-cli-skill.md), [`create-payment-credential`](../skills/create-payment-credential/SKILL.md), and [`link-balance`](../skills/link-balance/SKILL.md)

### Initial setup

In order to let your agent spend without approvals, your user must set up two things in Link: a balance and an approval policy.

1. **Link balance:** The user must onboard to Link balance and fund their account.  
2. **Approval policy:** The user creates an approval policy for your agent. It defines the maximum amount your agent can spend on a single purchase without asking for approval.

You can direct your user to complete these steps by sending them a setup URL. The setup URL contains the following query parameters.

| Parameter | Value | Notes |
| :---- | :---- | :---- |
| `key` | Your Stripe merchant's publishable key |  |
| `client_id` | Your Agent’s Client ID | This needs to be manually provisioned and provided by Link. Get in touch with the Link team to get a Client ID if you don’t have one yet. |
| `desired_balance_amount` | The total amount (in cents) that you’d like your user to have in their balance. | In the “add money” step, if the user’s balance is below your desired amount, the Link UI will prefill the number required to reach the desired amount. The user can still change the amount they choose to add. Must be a whole number of dollars. |
| `currency` | usd | If your URL is including the `desired_balance_amount` parameter, you must include this parameter with value `usd`. |
| `desired_transaction_limit` | Amount (in cents) that you’d like your agent to be able to spend without human approval | In the approval policy setup, the UI will be prefilled with this value. The user can change the amount to be any value during this step. Must be a whole number of dollars. |
| `completion_callback_url` | Your callback url | Callback url that will be used to direct the user back to your application once the flow is complete. Must be registered with your Agent merchant account. You don't need a separate callback url for balance setup: if one is already registered for your client ID, you can use it here. |
| `nonce` | Your nonce | nonce (optional): If provided along with  `completion_callback_url`  it is returned along with `status=success`  in the callback url example: `<completion_callback_url>?nonce=<original nonce value>&status=success` |

Example request for a \$5.00 transaction limit and \$10.00 total balance:

```
https://app.link.com/balance/setup?key=<YOUR_CLIENT_PK>&client_id=<YOUR_CLIENT_ID>&desired_balance_amount=1000&currency=usd&desired_transaction_limit=500
```

The setup URL sends your user to a Link flow with the following steps, some of which will be skipped depending on your query parameter values:

1. **Balance onboarding:** If the user has never set up Link balance, they fill out some basic KYC details to create their balance. For existing agent wallet users with link-cli set up, the new info to be collected is DOB and the last 4 digits of their SSN. If the user already has Link balance set up, they skip this and go directly to step 2\.  
2. **Add money:** The user can add money to their Link balance. The UI will prefill the amount to add based on the `desired_balance_amount` query parameter, but it is editable by the user. If this parameter is not defined, or if the user already has a Link balance greater than or equal to the desired balance amount, they skip this step and go directly to step 3\.  
3. **Approval policy setup:** The user sets the max amount that your agent can spend on a single purchase without requesting approval. The UI will prefill the value using the `desired_transaction_limit` query parameter, but it is editable by the user. If this parameter is defined, the user will always see this step, even if the desired limit is lower than the user’s existing limit. If you exclude this parameter, this step is skipped.

### Requesting a top-up

If the user’s Link balance is too low, you can use the setup URL to ask your user to add money. This will not require onboarding or updating the approval policy. In this example, the link is sending the user to top-up their balance to \$50.

```
https://app.link.com/balance/setup?key=<YOUR_CLIENT_PK>&client_id=<YOUR_CLIENT_ID>&desired_balance_amount=5000&currency=usd
```

### Changing the approval policy

If the user’s purchase limit is too low to accomplish what your agent needs to do, you can use the setup URL to ask your user to update it to a new amount. You can also send your user to lower the amount if they ask to do so. In this example, the URL is sending the user to change the purchase limit in their approval policy to \$25.

```
https://app.link.com/balance/setup?key=<YOUR_CLIENT_PK>&client_id=<YOUR_CLIENT_ID>&desired_transaction_limit=2500
```

## Usage guide

### Reading the Link balance

If your user has Link balance set up, `link-cli payment-methods list --format json` returns a new payment details for Link balance, which has type “BALANCE” and includes an amount:

```json
  {
    "id": "csmrpd_<ID>",
    "type": "BALANCE",
    "is_default": false,
    "name": "Balance",
    "balance_details": {
      "available_balance": {
        "amount": 300, # in cents
        "currency": "usd"
      }
    }
  }
```

### Spending with Link balance

To understand how much your agent can spend without approvals, call `link-cli approval-policy retrieve --format json` which should return the following:

```json
{
  "rules": [
    {
      "action": "spend_request_create",
      "limits": {
        "per_purchase": {
          "amount": 1000, # in cents
          "currency": "usd"
        }
      },
      "allowed_payment_methods": [
        "csmrpd_<ID>" # balance payment-method id
      ]
    }
  ]
}

```

If `allowed_payment_methods` is present, it must include the user’s Link balance ID.  The `per_purchase` amount returns the maximum amount that can be spent in a single purchase without requesting approval.

When a spend request is using Link balance as the payment method and is lower than the amount defined in the approval policy, it can use the `--use-approval-policy` flag to be approved automatically. Note that the Link balance must cover the entire purchase including tax, shipping, and fees in order for the spend request to be approved.

```
link-cli spend-request create \
     --use-approval-policy \
     --payment-method-id csmrpd_<ID> \
     --amount 4500 \
     --currency usd \
     --merchant-name "Example Shoes" \
     --merchant-url "https://shoes.example" \
     --context "Buying Trail Runner size 10 from Example Shoes, which the user asked the agent to purchase as soon as it came back in stock." \
     --line-item "name:Trail Runner size 10,unit_amount:4500,quantity:1" \
     --total "type:total,display_text:Total,amount:4500" \
     --format json

```

After creating the spend request, it will return the spend request object, and the status should be `approved`.

Then run `link-cli spend-request retrieve <id> --include card --format json`. This will return the spend request info with a `card` object including the card number, CVC, expiration, and other info.

You can also create normal spend requests that do require approval using Link balance by excluding the  `--use-approval-policy` flag.

### Usage tips

When your agent plans to spend without requesting approval, it’s important to check the user’s Link balance and approval policy ahead of time. If either the Link balance or purchase limit is too low, you should construct a setup URL for your user to increase them to the required amounts.

For delayed or scheduled purchases, your agent should also check the balance and approval policy once more directly before creating the spend request in order to ensure the payment will be successful.