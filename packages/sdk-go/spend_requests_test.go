package link

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestCreateSpendRequestCallbackEncoding(t *testing.T) {
	callbackURL := "https://agent.example.com/link/callback?return=%2fcheckout"
	nonce := " opaque+nonce 😀 "
	for _, withCallback := range []bool{false, true} {
		t.Run(map[bool]string{false: "omitted", true: "present"}[withCallback], func(t *testing.T) {
			params := CreateSpendRequestParams{Context: "purchase"}
			expected := map[string]any{"context": "purchase"}
			if withCallback {
				params.CompletionCallbackURL = &callbackURL
				params.Nonce = &nonce
				expected["completion_callback_url"] = callbackURL
				expected["nonce"] = nonce
			}
			data, err := json.Marshal(params)
			assertNoError(t, err)
			var body map[string]any
			assertNoError(t, json.Unmarshal(data, &body))
			if !reflect.DeepEqual(body, expected) {
				t.Fatalf("body = %#v, want %#v", body, expected)
			}
		})
	}
}

type callbackTestTransport func(*http.Request) (*http.Response, error)

func (transport callbackTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestSpendRequestCallbackRoundTrip(t *testing.T) {
	callbackURL := "https://agent.example.com/link/callback?return=%2fcheckout"
	nonce := " opaque+nonce 😀 "
	query := "?completion_callback_url=https%3A%2F%2Fagent.example%2Fcallback%3Freturn%3Da%252Fb&nonce=%20opaque%2Bnonce%20"
	approvalURL := "https://app.link.com/approve" + query
	actionURL := "https://app.link.com/verify" + query
	responseBody, err := json.Marshal(map[string]any{
		"id": "sr_callback", "status": "requires_action", "approval_url": approvalURL,
		"status_details": map[string]any{"requires_action": map[string]any{
			"next_action": map[string]any{
				"type": "identity_verification", "display_message": "Verify identity",
				"resolution": "create_new_spend_request", "action_url": actionURL,
			},
		}},
	})
	assertNoError(t, err)
	client, err := NewClient(Options{
		AccessToken: "token",
		HTTPClient: &http.Client{Transport: callbackTestTransport(func(request *http.Request) (*http.Response, error) {
			if request.Method == http.MethodPost {
				var body map[string]any
				assertNoError(t, json.NewDecoder(request.Body).Decode(&body))
				if body["completion_callback_url"] != callbackURL || body["nonce"] != nonce {
					t.Fatalf("callback context changed in HTTP body: %#v", body)
				}
			}
			return &http.Response{
				StatusCode: http.StatusOK, Header: make(http.Header),
				Body: io.NopCloser(strings.NewReader(string(responseBody))),
			}, nil
		})},
	})
	assertNoError(t, err)
	for _, method := range []string{"create", "retrieve"} {
		t.Run(method, func(t *testing.T) {
			var result *SpendRequest
			var err error
			if method == "create" {
				result, err = client.SpendRequests.Create(context.Background(), CreateSpendRequestParams{
					Context: "purchase", CompletionCallbackURL: &callbackURL, Nonce: &nonce,
				})
			} else {
				result, err = client.SpendRequests.Retrieve(context.Background(), "sr_callback", nil)
			}
			assertNoError(t, err)
			if result == nil || result.ApprovalURL == nil || *result.ApprovalURL != approvalURL {
				t.Fatalf("approval URL changed: %#v", result)
			}
			action := result.StatusDetails.RequiresAction.NextAction
			if action.ActionURL == nil || *action.ActionURL != actionURL {
				t.Fatalf("action URL changed: %#v", action)
			}
		})
	}
}
