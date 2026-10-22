package link

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func approvalPolicyClient(t *testing.T, status int, body string, requests *[]*http.Request) *Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if requests != nil {
			*requests = append(*requests, request)
		}
		response.WriteHeader(status)
		_, _ = response.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	client, err := NewClient(Options{AccessToken: "test_token", APIBaseURL: server.URL})
	assertNoError(t, err)
	return client
}

func TestRetrieveApprovalPolicy(t *testing.T) {
	var requests []*http.Request
	client := approvalPolicyClient(t, http.StatusOK, `{"rules":[{"action":"spend_request_create","limits":{"per_purchase":{"amount":5000,"currency":"usd"}},"allowed_payment_methods":["csmrpd_2","csmrpd_1"]}]}`, &requests)
	policy, err := client.ApprovalPolicy.Retrieve(context.Background())
	assertNoError(t, err)
	want := &ApprovalPolicy{Rules: []ApprovalPolicyRule{{
		Action:                ApprovalPolicyActionSpendRequestCreate,
		Limits:                ApprovalPolicyLimits{PerPurchase: ApprovalPolicyAmount{Amount: 5000, Currency: "usd"}},
		AllowedPaymentMethods: []string{"csmrpd_2", "csmrpd_1"},
	}}}
	if !reflect.DeepEqual(policy, want) {
		t.Fatalf("got %#v", policy)
	}
	if len(requests) != 1 || requests[0].Method != http.MethodGet || requests[0].URL.Path != "/approval-policy" ||
		requests[0].Header.Get("Authorization") != "Bearer test_token" {
		t.Fatalf("got requests %#v", requests)
	}
}

func TestRetrieveApprovalPolicyEmpty(t *testing.T) {
	policy, err := approvalPolicyClient(t, http.StatusOK, `{"rules":[]}`, nil).ApprovalPolicy.Retrieve(context.Background())
	if err != nil || policy.Rules == nil || len(policy.Rules) != 0 {
		t.Fatalf("policy %#v, error %v", policy, err)
	}
}

func TestRetrieveApprovalPolicyAPIErrors(t *testing.T) {
	for _, test := range []struct {
		status  int
		body    string
		message string
	}{
		{http.StatusForbidden, `{"error":{"code":"feature_unavailable"}}`, "Failed to retrieve approval policy (403): feature_unavailable"},
		{http.StatusNotFound, `{"error":{"message":"No approval policy has been configured","code":"approval_policy_not_found"}}`, "Failed to retrieve approval policy (404): No approval policy has been configured"},
	} {
		_, err := approvalPolicyClient(t, test.status, test.body, nil).ApprovalPolicy.Retrieve(context.Background())
		var apiError *LinkAPIError
		if !errors.As(err, &apiError) || apiError.Status != test.status || err.Error() != test.message {
			t.Fatalf("got %v", err)
		}
	}
}

func TestRetrieveApprovalPolicyInvalidResponses(t *testing.T) {
	for _, body := range []string{
		`{"rules":[{"action":"spend_request_create"}]}`,
		`{"rules":"not an array"}`,
		`{}`,
		`{"rules":[{"action":"spend_request_create","limits":{"per_purchase":{"currency":"usd"}}}]}`,
	} {
		_, err := approvalPolicyClient(t, http.StatusOK, body, nil).ApprovalPolicy.Retrieve(context.Background())
		var responseError *LinkResponseError
		if !errors.As(err, &responseError) || responseError.Code != "invalid_response" || responseError.Status != http.StatusOK {
			t.Fatalf("body %s: got %v", body, err)
		}
	}
}
