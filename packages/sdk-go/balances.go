package link

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// BalancesResource provides balance operations.
type BalancesResource struct {
	base *baseResource
}

// List returns a page of balances.
func (r *BalancesResource) List(ctx context.Context, params *ListBalancesParams) (*BalancesPage, error) {
	endpoint, err := url.Parse(r.base.baseURL + "/balances")
	if err != nil {
		return nil, newConfigurationError("Invalid balances URL: " + err.Error())
	}
	query := endpoint.Query()
	if params != nil {
		for _, source := range params.Sources {
			query.Add("sources[]", source)
		}
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
		return nil, newAPIError("list balances", response.status, response.data, response.rawBody)
	}
	var result BalancesPage
	if err := decodeResponse("list balances", response, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
