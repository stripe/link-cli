Load create-payment-credential for spend requests and payment credentials, or
financial-insights for balances, transactions, and funding sources. Use their
discovered mount-prefixed names, such as link__create-payment-credential and
link__financial-insights.

Use this extension's native tools and their input schemas. Authentication is
configured by the application; do not install the CLI or run CLI login commands.

Use the wallet configured by the application. Never ask for access tokens in the
conversation. If Eve requests authorization, let the user complete its Link
sign-in flow; never ask them to paste credentials into chat. Creating a spend
request is not purchase approval; check its current status before using
credentials. Do not repeat card numbers, security codes, or
payment tokens in conversational replies.
