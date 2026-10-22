package link

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateReportSendsAttemptTrace(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		_, _ = response.Write([]byte(`{"object":"agent_observation","created_at":"2026-01-01T00:00:00Z","domain":"merchant.example","outcome":"blocked","spend_request_id":"lsrq_1","status":"recorded"}`))
	}))
	defer server.Close()
	client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	trace := "1. Opened checkout\n2. " + strings.Repeat("x", ReportAttemptTraceMaxLength)
	_, err := client.Reports.Create(context.Background(), CreateReportParams{
		Domain:         "merchant.example",
		Outcome:        ReportOutcomeBlocked,
		SpendRequestID: "lsrq_1",
		AttemptTrace:   &trace,
	})
	if err != nil {
		t.Fatal(err)
	}
	if body["attempt_trace"] != trace {
		t.Fatalf("got body %#v", body)
	}

	body = nil
	_, err = client.Reports.Create(context.Background(), CreateReportParams{Domain: "merchant.example", Outcome: ReportOutcomeSuccess, SpendRequestID: "lsrq_1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := body["attempt_trace"]; ok {
		t.Fatalf("omitted trace was sent: %#v", body)
	}
}
