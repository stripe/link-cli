package link

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestListAvailableInsightTypes(t *testing.T) {
	var path string
	var query map[string][]string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		path = request.URL.Path
		query = request.URL.Query()
		_, _ = response.Write([]byte(`{"data":[{"id":"top_brands","description":"Top brands","authorization_remediation":{"authorization_details":[{"type":"source","actions":["read_link_transactions"]}]},"future":true}],"has_more":true,"url":"/insights/available_types"}`))
	}))
	defer server.Close()
	client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	limit := int64(1)
	startingAfter := "previous"
	page, err := client.Insights.ListAvailableTypes(context.Background(), &ListInsightTypesParams{Limit: &limit, StartingAfter: &startingAfter})
	if err != nil {
		t.Fatal(err)
	}
	if path != "/insights/available_types" || !reflect.DeepEqual(query, map[string][]string{"limit": {"1"}, "starting_after": {"previous"}}) {
		t.Fatalf("got %s %#v", path, query)
	}
	if !page.HasMore || len(page.Data) != 1 || page.AdditionalFields["url"] != "/insights/available_types" {
		t.Fatalf("got %#v", page)
	}
	insightType := page.Data[0]
	if insightType.ID != "top_brands" || insightType.AdditionalFields["future"] != true ||
		insightType.AuthorizationRemediation == nil ||
		!reflect.DeepEqual(insightType.AuthorizationRemediation.AuthorizationDetails, []InsightAuthorizationDetail{{Type: "source", Actions: []string{"read_link_transactions"}}}) {
		t.Fatalf("got %#v", insightType)
	}
}

func TestListInsightsFiltersAndPreservesValues(t *testing.T) {
	var rawQuery string
	body := `{"data":[{"id":"spend_by_category","description":"Spend","status":"available","as_of":1700000000,"data":[{"label":"Dining","value":{"type":"future_type","amount":1200}}]},{"id":"top_brands","description":"Brands","status":"unavailable","error_code":"insufficient_authorization","error_message":"Grant access","authorization_remediation":{"scope":["transactions:read"]}}],"has_more":false}`
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		rawQuery = request.URL.RawQuery
		_, _ = response.Write([]byte(body))
	}))
	defer server.Close()
	client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	page, err := client.Insights.List(context.Background(), &ListInsightsParams{Insights: []string{"spend_by_category", "top_brands"}})
	if err != nil {
		t.Fatal(err)
	}
	if rawQuery != "insights%5B%5D=spend_by_category&insights%5B%5D=top_brands" {
		t.Fatalf("got query %q", rawQuery)
	}
	available := page.Data[0]
	if available.AsOf == nil || *available.AsOf != 1700000000 ||
		!reflect.DeepEqual(available.Data[0].Value, map[string]any{"type": "future_type", "amount": float64(1200)}) {
		t.Fatalf("got %#v", available)
	}
	unavailable := page.Data[1]
	if unavailable.Data != nil || unavailable.ErrorCode == nil || *unavailable.ErrorCode != "insufficient_authorization" ||
		unavailable.AuthorizationRemediation == nil || unavailable.AuthorizationRemediation.Scope[0] != "transactions:read" {
		t.Fatalf("got %#v", unavailable)
	}

	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip, original any
	_ = json.Unmarshal(encoded, &roundTrip)
	_ = json.Unmarshal([]byte(body), &original)
	if !reflect.DeepEqual(roundTrip, original) {
		t.Fatalf("round trip changed response:\n%s", encoded)
	}
}

func TestListInsightsErrors(t *testing.T) {
	body := `{"error":{"message":"Invalid limit"}}`
	status := http.StatusBadRequest
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(status)
		_, _ = response.Write([]byte(body))
	}))
	defer server.Close()
	client, _ := NewClient(Options{AccessToken: "token", APIBaseURL: server.URL})
	_, err := client.Insights.List(context.Background(), nil)
	var apiError *LinkAPIError
	if !errors.As(err, &apiError) || apiError.Status != http.StatusBadRequest {
		t.Fatalf("got %#v", err)
	}

	status = http.StatusOK
	body = `{"data":[{"id":123}],"has_more":false}`
	_, err = client.Insights.ListAvailableTypes(context.Background(), nil)
	var responseError *LinkResponseError
	if !errors.As(err, &responseError) {
		t.Fatalf("got %#v", err)
	}
}
