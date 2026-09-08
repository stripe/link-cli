package link

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

// TransactionsResource provides transaction operations.
type TransactionsResource struct {
	base *baseResource
}

// List returns a page of transactions.
func (r *TransactionsResource) List(ctx context.Context, params *ListTransactionsParams) (*TransactionsPage, error) {
	endpoint, err := url.Parse(r.base.baseURL + "/transactions")
	if err != nil {
		return nil, newConfigurationError("Invalid transactions URL: " + err.Error())
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
		if params.StartDate != nil {
			query.Set("date_start", *params.StartDate)
		}
		if params.EndDate != nil {
			query.Set("date_end", *params.EndDate)
		}
		if params.Category != nil {
			query.Set("category", *params.Category)
		}
		if params.Origin != nil {
			query.Set("origin", string(*params.Origin))
		}
		for _, source := range params.Sources {
			query.Add("sources[]", source)
		}
	}
	endpoint.RawQuery = query.Encode()
	response, err := r.base.fetch(ctx, http.MethodGet, endpoint.String(), nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("list transactions", response.status, response.data, response.rawBody)
	}
	data := bytes.TrimSpace([]byte(response.rawBody))
	var page TransactionsPage
	if len(data) > 0 && data[0] == '[' {
		if err := json.Unmarshal(data, &page.Data); err != nil {
			return nil, newResponseError("list transactions", response.status, err)
		}
	} else {
		if err := decodeResponse("list transactions", response, &page); err != nil {
			return nil, err
		}
	}
	return &page, nil
}
