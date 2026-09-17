package link

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPaymentMethodsRetrieve(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/payment-details/pd_123" {
			t.Fatalf("got %s %s", request.Method, request.URL.Path)
		}
		_, _ = response.Write([]byte(`{
			"id":"pd_123",
			"type":"BALANCE",
			"is_default":true,
			"name":"Link balance",
			"balance_details":{"available_balance":{"amount":1250,"currency":"usd"}}
		}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	method, err := client.PaymentMethods.Retrieve(context.Background(), "pd_123")
	assertNoError(t, err)
	if method == nil || method.ID != "pd_123" || method.BalanceDetails == nil {
		t.Fatalf("unexpected payment method: %#v", method)
	}
	if got := method.BalanceDetails.AvailableBalance; got.Amount != 1250 || got.Currency != "usd" {
		t.Fatalf("unexpected available balance: %#v", got)
	}
}

func TestPaymentMethodsRetrieveReturnsNilWhenMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNotFound)
		_, _ = response.Write([]byte(`{"error":{"message":"Payment details not found"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	method, err := client.PaymentMethods.Retrieve(context.Background(), "pd_missing")
	assertNoError(t, err)
	if method != nil {
		t.Fatalf("got %#v, want nil", method)
	}
}

func TestPaymentMethodsRetrieveEscapesID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.RequestURI != "/payment-details/pd%2F..%2Fother" {
			t.Fatalf("got request URI %q", request.RequestURI)
		}
		response.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	_, err = client.PaymentMethods.Retrieve(context.Background(), "pd/../other")
	assertNoError(t, err)
}
