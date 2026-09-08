# Link Go SDK

Go SDK for agents that use Link. It provides typed resources for Link APIs and
accepts an access token from your application.

The SDK does not perform login, persist credentials, or own refresh tokens.
Authentication state and user-facing authorization flows belong to the CLI or
application embedding the SDK.

## Install

```bash
go get github.com/stripe/link-cli/packages/sdk-go
```

The SDK requires Go 1.23 or newer. Its package name is `link`:

```go
import link "github.com/stripe/link-cli/packages/sdk-go"
```

## Quick start

Pass an access token when creating the client:

```go
package main

import (
	"context"
	"log"
	"os"

	link "github.com/stripe/link-cli/packages/sdk-go"
)

func main() {
	client, err := link.NewClient(link.Options{
		AccessToken: os.Getenv("LINK_ACCESS_TOKEN"),
	})
	if err != nil {
		log.Fatal(err)
	}

	paymentMethods, err := client.PaymentMethods.List(context.Background())
	if err != nil {
		log.Fatal(err)
	}

	log.Printf("found %d payment methods", len(paymentMethods))
}
```

Use a fixed token for a short-lived job or when the caller replaces the entire
client as credentials change.

## Credentials

Exactly one credential option is required.

### Dynamic access tokens

When your application manages expiring credentials, provide `GetAccessToken`.
The SDK calls it for each request. After a `401` response, the SDK calls it once
with `ForceRefresh: true` and retries the request with the returned token.

```go
client, err := link.NewClient(link.Options{
	GetAccessToken: func(
		ctx context.Context,
		options link.GetAccessTokenOptions,
	) (string, error) {
		return credentialManager.LinkAccessToken(ctx, options.ForceRefresh)
	},
})
```

The credential manager should coalesce concurrent refreshes if several
requests can receive a `401` at the same time. A client configured with a fixed
`AccessToken` does not retry a `401` because it cannot obtain a different token.

## User-approved purchase flow

Amounts are expressed in the currency's minor unit, such as cents for USD.
`Context` must be at least 100 characters and should tell the user what the
agent is buying and why.

```go
paymentMethods, err := client.PaymentMethods.List(ctx)
if err != nil {
	return err
}
if len(paymentMethods) == 0 {
	return errors.New("the user needs to add a Link payment method")
}

paymentMethod := &paymentMethods[0]
for index := range paymentMethods {
	if paymentMethods[index].IsDefault {
		paymentMethod = &paymentMethods[index]
		break
	}
}

amount := int64(2599)
currency := "usd"
credentialType := link.CredentialTypeCard
merchantName := "Acme"
merchantURL := "https://acme.example"

spendRequest, err := client.SpendRequests.Create(
	ctx,
	link.CreateSpendRequestParams{
		PaymentDetails: &paymentMethod.ID,
		CredentialType: &credentialType,
		Amount:         &amount,
		Currency:       &currency,
		MerchantName:   &merchantName,
		MerchantURL:    &merchantURL,
		Context:        "The user asked the agent to buy the selected item from Acme for $25.99, including the displayed shipping cost.",
	},
)
if err != nil {
	return err
}

approval, err := client.SpendRequests.RequestApproval(ctx, spendRequest.ID)
if err != nil {
	return err
}

fmt.Printf("Ask the user to approve this purchase: %s\n", approval.ApprovalURL)
fmt.Printf("Persist this spend request ID for the next run: %s\n", spendRequest.ID)
```

Retrieve the request in a later agent run:

```go
result, err := client.SpendRequests.Retrieve(ctx, spendRequestID, nil)
if err != nil {
	return err
}
if result == nil {
	return errors.New("spend request not found")
}

switch result.Status {
case link.SpendRequestStatusApproved:
	// Use the returned credential without placing it in logs or chat.
case link.SpendRequestStatusCreated:
	// Approval has not been requested yet.
case link.SpendRequestStatusPendingApproval:
	// Wait for the user to approve the request.
case link.SpendRequestStatusRequiresAction:
	details := result.StatusDetails
	if details == nil || details.RequiresAction == nil {
		return errors.New("spend request requires action without instructions")
	}
	action := details.RequiresAction.NextAction
	if action.Resolution == link.NextActionResolutionAutoResume {
		// Schedule a later retry.
		break
	}
	// Surface action.DisplayMessage and action.ActionURL to the user.
case link.SpendRequestStatusDenied,
	link.SpendRequestStatusExpired,
	link.SpendRequestStatusSucceeded,
	link.SpendRequestStatusFailed,
	link.SpendRequestStatusCanceled:
	// Stop processing this request.
}
```

Only a `requires_action` result whose `Resolution` is
`NextActionResolutionAutoResume` should be polled automatically. For any other
resolution, surface the action to the user and follow its instructions. Keep
returned card or shared-payment-token credentials out of model context, logs,
and user-visible messages.

## Configuration

```go
client, err := link.NewClient(link.Options{
	AccessToken: accessToken,
	HTTPClient: &http.Client{
		Timeout: 30 * time.Second,
	},
	DefaultHeaders: http.Header{
		"X-Agent-Version": []string{"acme-agent/1.0"},
	},
	Verbose:             true,
	Logger:              diagnosticsLogger,
	APIBaseURL:          "https://api.link.com",
	SpendRequestBaseURL: "https://api.link.com",
})
```

`HTTPClient` supports custom transports, proxies, tracing, and timeouts.
`Logger` accepts any value with a `Debug(string)` method. Base URLs must be
absolute HTTP(S) URLs without a query or fragment; `NewClient` rejects invalid
configuration before making a request.

Verbose logging includes request methods, URLs, and response status codes. It
does not include authorization headers or request and response bodies.

## Errors

The SDK returns typed errors:

- `LinkConfigurationError` for invalid or missing client configuration
- `LinkTransportError` when a request cannot reach Link
- `LinkAPIError` for non-success API responses
- `LinkResponseError` when a successful response cannot be decoded

`LinkAPIError` includes `Status`, `Code`, `RawBody`, and structured `Details`
fields for programmatic handling.

```go
var apiError *link.LinkAPIError
if errors.As(err, &apiError) {
	log.Printf(
		"Link returned status=%d code=%s details=%v",
		apiError.Status,
		apiError.Code,
		apiError.Details,
	)
}
```

Every SDK-created error implements `LinkError`, so callers can handle all SDK
errors through one interface. Wrapped causes remain compatible with `errors.Is`.

```go
var linkError link.LinkError
if errors.As(err, &linkError) {
	log.Printf("Link SDK error code=%s", linkError.ErrorCode())
}
```

## Client resources

- `SpendRequests` — create, approve, retrieve, update, cancel, and list
- `PaymentMethods` — list Link payment methods
- `ShippingAddresses` — list shipping addresses
- `UserInfo` — retrieve Link user information
- `Transactions` — list transactions
- `Sources` — list connected sources
- `Balances` — list balances
- `WebBotAuth` — sign URLs for Web Bot Auth
- `Reports` — report agent outcomes

## Go data model

For optional request slices and maps, `nil` means omitted while a non-nil empty
value is encoded as `[]` or `{}`. For example,
`LineItems: []link.LineItem{}` explicitly clears the collection.

Optional nullable JSON fields use pointers. As is conventional in Go, a `nil`
pointer does not distinguish an omitted property from an explicit JSON `null`.
`TransactionsPage`, `Source`, `SourcesPage`, `Balance`, and `BalancesPage`
preserve forward-compatible response properties in `AdditionalFields`.

## Versioning

This is a nested Go module. Releases use tags in the form
`packages/sdk-go/vX.Y.Z`; creating such a repository tag makes that version
available through the Go module proxy.
