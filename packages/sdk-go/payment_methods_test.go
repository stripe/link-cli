package link

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdatePaymentMethod(t *testing.T) {
	var method, requestURI, contentType string
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		method = request.Method
		requestURI = request.RequestURI
		contentType = request.Header.Get("Content-Type")
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"id":"pd/../other","type":"CARD","is_default":true,"name":"Visa","nickname":"Work card"}`))
	}))
	defer server.Close()

	client, err := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.PaymentMethods.Update(context.Background(), "pd/../other", UpdatePaymentMethodParams{Nickname: "Work card"})
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost || requestURI != "/payment-details/pd%2F..%2Fother" {
		t.Fatalf("got %s %s", method, requestURI)
	}
	if contentType != "application/json" || body["nickname"] != "Work card" {
		t.Fatalf("got content type %q and body %#v", contentType, body)
	}
	if result.Nickname == nil || *result.Nickname != "Work card" {
		t.Fatalf("got %#v", result)
	}
}

func TestUpdatePaymentMethodPreservesEmptyNickname(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if value, ok := body["nickname"]; !ok || value != "" {
			t.Fatalf("got body %#v", body)
		}
		_, _ = response.Write([]byte(`{"id":"pd_1","type":"CARD","is_default":true,"name":"Visa","nickname":null}`))
	}))
	defer server.Close()
	client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	result, err := client.PaymentMethods.Update(context.Background(), "pd_1", UpdatePaymentMethodParams{Nickname: ""})
	if err != nil || result.Nickname != nil {
		t.Fatalf("result %#v, error %v", result, err)
	}
}

func TestUpdatePaymentMethodErrors(t *testing.T) {
	t.Run("nested API error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.WriteHeader(http.StatusForbidden)
			_, _ = response.Write([]byte(`{"error":{"message":"feature unavailable"}}`))
		}))
		defer server.Close()
		client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
		_, err := client.PaymentMethods.Update(context.Background(), "pd_1", UpdatePaymentMethodParams{Nickname: "Work"})
		var apiError *LinkAPIError
		if !errors.As(err, &apiError) || apiError.Status != http.StatusForbidden || !strings.Contains(err.Error(), "feature unavailable") {
			t.Fatalf("got %#v", err)
		}
	})

	t.Run("malformed success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			_, _ = response.Write([]byte(`{"id":123}`))
		}))
		defer server.Close()
		client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
		_, err := client.PaymentMethods.Update(context.Background(), "pd_1", UpdatePaymentMethodParams{Nickname: "Work"})
		var responseError *LinkResponseError
		if !errors.As(err, &responseError) {
			t.Fatalf("got %#v", err)
		}
	})
}

func TestUpdatePaymentMethodRetriesProvider401(t *testing.T) {
	requests := 0
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		if requests == 1 {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = response.Write([]byte(`{"id":"pd_1","type":"CARD","is_default":true,"name":"Visa","nickname":"Work"}`))
	}))
	defer server.Close()
	client, _ := NewClient(Options{
		APIBaseURL: server.URL,
		GetAccessToken: func(_ context.Context, options GetAccessTokenOptions) (string, error) {
			providerCalls++
			if providerCalls == 2 && !options.ForceRefresh {
				t.Fatal("second provider call did not force refresh")
			}
			return "token", nil
		},
	})
	if _, err := client.PaymentMethods.Update(context.Background(), "pd_1", UpdatePaymentMethodParams{Nickname: "Work"}); err != nil {
		t.Fatal(err)
	}
	if requests != 2 || providerCalls != 2 {
		t.Fatalf("got %d requests and %d provider calls", requests, providerCalls)
	}
}
