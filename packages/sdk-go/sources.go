package link

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// SourcesResource provides connected-source operations.
type SourcesResource struct {
	base *baseResource
}

// List returns a page of connected sources.
func (r *SourcesResource) List(ctx context.Context, params *ListSourcesParams) (*SourcesPage, error) {
	endpoint, err := url.Parse(r.base.baseURL + "/sources")
	if err != nil {
		return nil, newConfigurationError("Invalid sources URL: " + err.Error())
	}
	query := endpoint.Query()
	if params != nil {
		if params.Limit != nil {
			query.Set("limit", strconv.FormatInt(*params.Limit, 10))
		}
		if params.StartingAfter != nil {
			query.Set("starting_after", *params.StartingAfter)
		}
		if params.EndingBefore != nil {
			query.Set("ending_before", *params.EndingBefore)
		}
	}
	endpoint.RawQuery = query.Encode()
	response, err := r.base.fetch(ctx, http.MethodGet, endpoint.String(), nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("list sources", response.status, response.data, response.rawBody)
	}
	var result SourcesPage
	if err := decodeResponse("list sources", response, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
