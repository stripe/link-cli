package link

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func assertNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestNewClientValidatesCredentials(t *testing.T) {
	tests := []struct {
		name    string
		options Options
		message string
	}{
		{name: "missing", options: Options{}, message: "Pass `AccessToken` or `GetAccessToken`"},
		{name: "empty", options: Options{AccessToken: "   "}, message: "`AccessToken` cannot be empty"},
		{
			name: "conflicting",
			options: Options{
				AccessToken:    "token",
				GetAccessToken: func(context.Context, GetAccessTokenOptions) (string, error) { return "other", nil },
			},
			message: "not both",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewClient(test.options)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("got %v, want message containing %q", err, test.message)
			}
			var configurationError *LinkConfigurationError
			if !errors.As(err, &configurationError) {
				t.Fatalf("got %T, want LinkConfigurationError", err)
			}
			if configurationError.Code != "configuration_error" {
				t.Fatalf("got code %q", configurationError.Code)
			}
		})
	}
}

func TestNewClientValidatesBaseURLs(t *testing.T) {
	tests := []Options{
		{AccessToken: "token", APIBaseURL: "%"},
		{AccessToken: "token", APIBaseURL: "relative/path"},
		{AccessToken: "token", APIBaseURL: "ftp://api.link.com"},
		{AccessToken: "token", APIBaseURL: "https://api.link.com?query=true"},
		{AccessToken: "token", SpendRequestBaseURL: "https://api.link.com#fragment"},
	}
	for _, options := range tests {
		_, err := NewClient(options)
		var configurationError *LinkConfigurationError
		if !errors.As(err, &configurationError) {
			t.Errorf("NewClient(%#v) returned %v, want LinkConfigurationError", options, err)
		}
	}
}

func TestAccessTokenProviderRefreshesOnceOnUnauthorized(t *testing.T) {
	var mu sync.Mutex
	var providerCalls []GetAccessTokenOptions
	provider := func(_ context.Context, options GetAccessTokenOptions) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		providerCalls = append(providerCalls, options)
		if options.ForceRefresh {
			return "fresh_token", nil
		}
		return "expired_token", nil
	}
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestCount++
		if request.Header.Get("Authorization") == "Bearer expired_token" {
			response.WriteHeader(http.StatusUnauthorized)
			_, _ = response.Write([]byte(`{"error":"expired_token"}`))
			return
		}
		_, _ = response.Write([]byte(`{"payment_details":[]}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{GetAccessToken: provider, APIBaseURL: server.URL})
	assertNoError(t, err)
	methods, err := client.PaymentMethods.List(context.Background())
	assertNoError(t, err)
	if len(methods) != 0 || requestCount != 2 {
		t.Fatalf("got %d methods and %d requests", len(methods), requestCount)
	}
	if !reflect.DeepEqual(providerCalls, []GetAccessTokenOptions{{}, {ForceRefresh: true}}) {
		t.Fatalf("provider calls differ: %#v", providerCalls)
	}
}

func TestFixedTokenDoesNotRetryAndReturnsTypedAPIError(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requestCount++
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"error":{"message":"token expired"}}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "fixed_token", APIBaseURL: server.URL})
	assertNoError(t, err)
	_, err = client.PaymentMethods.List(context.Background())
	var apiError *LinkAPIError
	if !errors.As(err, &apiError) {
		t.Fatalf("got %T, want LinkAPIError", err)
	}
	if apiError.Status != http.StatusUnauthorized || apiError.Code != "api_error" || !strings.Contains(apiError.Error(), "token expired") {
		t.Fatalf("unexpected API error: %#v", apiError)
	}
	if requestCount != 1 {
		t.Fatalf("got %d requests, want 1", requestCount)
	}
}

func TestDefaultHeadersDoNotOverrideResourceHeaders(t *testing.T) {
	var captured http.Header
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		captured = request.Header.Clone()
		_, _ = response.Write([]byte(`{"object":"agent_observation","created_at":"now","domain":"merchant.example","outcome":"success","spend_request_id":"sr_123","status":"created"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{
		AccessToken:    "token",
		APIBaseURL:     server.URL,
		DefaultHeaders: http.Header{"Content-Type": []string{"text/plain"}, "X-Agent-Version": []string{"test/1.0"}},
	})
	assertNoError(t, err)
	_, err = client.Reports.Create(context.Background(), CreateReportParams{Domain: "merchant.example", Outcome: ReportOutcomeSuccess, SpendRequestID: "sr_123"})
	assertNoError(t, err)
	if captured.Get("Content-Type") != "application/json" {
		t.Fatalf("got content type %q", captured.Get("Content-Type"))
	}
	if captured.Get("X-Agent-Version") != "test/1.0" {
		t.Fatalf("missing default header: %#v", captured)
	}
}

type failingHTTPClient struct{ err error }

func (client failingHTTPClient) Do(*http.Request) (*http.Response, error) {
	return nil, client.err
}

func TestTransportAndResponseErrorsAreTyped(t *testing.T) {
	rootCause := errors.New("network unavailable")
	client, err := NewClient(Options{AccessToken: "token", HTTPClient: failingHTTPClient{err: rootCause}})
	assertNoError(t, err)
	_, err = client.PaymentMethods.List(context.Background())
	var transportError *LinkTransportError
	if !errors.As(err, &transportError) || !errors.Is(err, rootCause) {
		t.Fatalf("got %v, want wrapped LinkTransportError", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"payment_details":{}}`))
	}))
	defer server.Close()
	client, err = NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	_, err = client.PaymentMethods.List(context.Background())
	var responseError *LinkResponseError
	if !errors.As(err, &responseError) || responseError.Code != "invalid_response" || responseError.Status != http.StatusOK {
		t.Fatalf("got %#v, want LinkResponseError", err)
	}
	var linkError LinkError
	if !errors.As(err, &linkError) || linkError.ErrorCode() != "invalid_response" {
		t.Fatalf("got %#v, want common LinkError", err)
	}
}

func TestResponseDecodingRejectsTypeMismatches(t *testing.T) {
	responses := []string{
		`null`,
		`{"payment_details":{}}`,
		`{"payment_details":[{"id":[],"type":"card","is_default":true,"name":"Visa"}]}`,
		`{"payment_details":[{"id":"pd_123","type":"card","is_default":[],"name":"Visa"}]}`,
	}
	for _, body := range responses {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			_, _ = response.Write([]byte(body))
		}))
		client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
		assertNoError(t, err)
		_, err = client.PaymentMethods.List(context.Background())
		server.Close()
		var responseError *LinkResponseError
		if !errors.As(err, &responseError) {
			t.Errorf("response %s returned %v, want LinkResponseError", body, err)
		}
	}
}

func TestExplicitEmptyCollectionsAreSent(t *testing.T) {
	var requestBody string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		data, _ := io.ReadAll(request.Body)
		requestBody = string(data)
		_, _ = response.Write([]byte(`{"id":"sr_123","status":"created","created_at":"now","updated_at":"now"}`))
	}))
	defer server.Close()
	client, err := NewClient(Options{AccessToken: "token", SpendRequestBaseURL: server.URL})
	assertNoError(t, err)
	_, err = client.SpendRequests.Update(context.Background(), "sr_123", UpdateSpendRequestParams{
		LineItems: []LineItem{},
		Totals:    []Total{},
	})
	assertNoError(t, err)
	if requestBody != `{"line_items":[],"totals":[]}` && requestBody != `{"totals":[],"line_items":[]}` {
		t.Fatalf("got request body %s", requestBody)
	}
}

func TestExplicitEmptyCollectionsMarshalAcrossRequestTypes(t *testing.T) {
	tests := []struct {
		name  string
		value any
		keys  []string
	}{
		{
			name: "create spend request",
			value: CreateSpendRequestParams{
				Context:   "A sufficiently detailed context for testing empty collection encoding.",
				LineItems: []LineItem{}, Totals: []Total{}, Metadata: map[string]string{},
			},
			keys: []string{"line_items", "totals", "metadata"},
		},
		{name: "report", value: CreateReportParams{Tags: []ReportTag{}}, keys: []string{"tags"}},
		{name: "line item", value: LineItem{Name: "item", Totals: []Total{}}, keys: []string{"totals"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data, err := json.Marshal(test.value)
			assertNoError(t, err)
			var fields map[string]json.RawMessage
			assertNoError(t, json.Unmarshal(data, &fields))
			for _, key := range test.keys {
				if value, ok := fields[key]; !ok || (string(value) != "[]" && string(value) != "{}") {
					t.Errorf("field %s was not encoded as an empty collection: %s", key, value)
				}
			}
		})
	}
}

func TestRetrieveReturnsNilOnNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()
	client, err := NewClient(Options{AccessToken: "token", SpendRequestBaseURL: server.URL})
	assertNoError(t, err)
	result, err := client.SpendRequests.Retrieve(context.Background(), "missing", nil)
	assertNoError(t, err)
	if result != nil {
		t.Fatalf("got %#v, want nil", result)
	}
}

func TestWebBotAuthCachesByAuthority(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		requestCount++
		_, _ = response.Write([]byte(`{"web_bot_auth":{"signature":"sig","signature_input":"input","signature_agent":"agent","authority":"merchant.example","expires_at":"2099-12-31T23:59:59Z"}}`))
	}))
	defer server.Close()
	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	assertNoError(t, err)
	_, err = client.WebBotAuth.SignURL(context.Background(), "https://merchant.example/one")
	assertNoError(t, err)
	_, err = client.WebBotAuth.SignURL(context.Background(), "https://merchant.example/two")
	assertNoError(t, err)
	if requestCount != 1 {
		t.Fatalf("got %d requests, want 1", requestCount)
	}
}

func TestGetDuplicateSpendRequest(t *testing.T) {
	details := map[string]any{
		"error": map[string]any{
			"duplicate_spend_request": map[string]any{
				"id": "sr_duplicate", "status": "created",
				"created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
			},
		},
	}
	err := &LinkAPIError{
		LinkSDKError: &LinkSDKError{Message: "duplicate", Code: "api_error"},
		Status:       http.StatusConflict,
		Details:      details,
	}
	duplicate := GetDuplicateSpendRequest(fmt.Errorf("wrapped: %w", err))
	if duplicate == nil || duplicate.ID != "sr_duplicate" {
		t.Fatalf("got %#v", duplicate)
	}
}
