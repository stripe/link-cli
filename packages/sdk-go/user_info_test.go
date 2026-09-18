package link

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUserInfoRetrieveDecodesAddressAndBalanceEligibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/userinfo" {
			t.Errorf("got path %q, want /userinfo", request.URL.Path)
			response.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = response.Write([]byte(`{
			"email":"user@example.com",
			"address":{
				"line1":"510 Townsend St",
				"line2":null,
				"city":"San Francisco",
				"state":"CA",
				"postal_code":"94103",
				"country":"US"
			},
			"eligible_for_balance":false
		}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	result, err := client.UserInfo.Retrieve(context.Background())
	assertNoError(t, err)

	if result.Address == nil || result.Address.Line1 == nil || *result.Address.Line1 != "510 Townsend St" {
		t.Fatalf("unexpected address: %#v", result.Address)
	}
	if result.Address.Line2 != nil {
		t.Fatalf("got line2 %q, want nil", *result.Address.Line2)
	}
	if result.EligibleForBalance == nil || *result.EligibleForBalance {
		t.Fatalf("got eligible_for_balance %#v, want false", result.EligibleForBalance)
	}
}

func TestUserInfoRetrievePreservesOmittedEnrichment(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"email":"user@example.com"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	result, err := client.UserInfo.Retrieve(context.Background())
	assertNoError(t, err)

	if result.Address != nil || result.EligibleForBalance != nil {
		t.Fatalf("unexpected enrichment: address=%#v eligible_for_balance=%#v", result.Address, result.EligibleForBalance)
	}
}

func TestUserInfoRetrieveDecodesNullAddressWithIneligibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"address":null,"eligible_for_balance":false}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	result, err := client.UserInfo.Retrieve(context.Background())
	assertNoError(t, err)

	if result.Address != nil {
		t.Fatalf("got address %#v, want nil", result.Address)
	}
	if result.EligibleForBalance == nil || *result.EligibleForBalance {
		t.Fatalf("got eligible_for_balance %#v, want false", result.EligibleForBalance)
	}
}
