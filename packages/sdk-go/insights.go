package link

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// InsightsResource provides precomputed financial insight operations.
type InsightsResource struct {
	base *baseResource
}

// ListAvailableTypes returns a page of insight types that can be requested.
func (r *InsightsResource) ListAvailableTypes(ctx context.Context, params *ListInsightTypesParams) (*AvailableInsightTypesPage, error) {
	endpoint, err := url.Parse(r.base.baseURL + "/insights/available_types")
	if err != nil {
		return nil, newConfigurationError("Invalid insights URL: " + err.Error())
	}
	query := endpoint.Query()
	if params != nil {
		setInsightsPagination(query, params.Limit, params.StartingAfter)
	}
	endpoint.RawQuery = query.Encode()
	var result AvailableInsightTypesPage
	if err := r.get(ctx, "list available insight types", endpoint.String(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// List returns a page of computed insights, optionally filtered by insight ID.
func (r *InsightsResource) List(ctx context.Context, params *ListInsightsParams) (*InsightsPage, error) {
	endpoint, err := url.Parse(r.base.baseURL + "/insights")
	if err != nil {
		return nil, newConfigurationError("Invalid insights URL: " + err.Error())
	}
	query := endpoint.Query()
	if params != nil {
		setInsightsPagination(query, params.Limit, params.StartingAfter)
		for _, insight := range params.Insights {
			query.Add("insights[]", insight)
		}
	}
	endpoint.RawQuery = query.Encode()
	var result InsightsPage
	if err := r.get(ctx, "list insights", endpoint.String(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *InsightsResource) get(ctx context.Context, operation, endpoint string, target any) error {
	response, err := r.base.fetch(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return err
	}
	if response.status < 200 || response.status >= 300 {
		return newAPIError(operation, response.status, response.data, response.rawBody)
	}
	return decodeResponse(operation, response, target)
}

func setInsightsPagination(query url.Values, limit *int64, startingAfter *string) {
	if limit != nil {
		query.Set("limit", strconv.FormatInt(*limit, 10))
	}
	if startingAfter != nil {
		query.Set("starting_after", *startingAfter)
	}
}
