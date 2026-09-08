package link

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// SpendRequestsResource provides spend-request operations.
type SpendRequestsResource struct {
	base *baseResource
}

// List returns active spend requests, or history when IncludeHistory is true.
func (r *SpendRequestsResource) List(ctx context.Context, params *ListSpendRequestsParams) ([]SpendRequest, error) {
	endpoint := r.base.baseURL + "/spend_requests"
	if params != nil && params.IncludeHistory {
		endpoint += "?include_history=true"
	}
	response, err := r.base.fetch(ctx, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("list spend requests", response.status, response.data, response.rawBody)
	}
	var envelope struct {
		Data []SpendRequest `json:"data"`
	}
	if err := decodeResponse("list spend requests", response, &envelope); err != nil {
		return nil, err
	}
	return envelope.Data, nil
}

// Create creates a spend request.
func (r *SpendRequestsResource) Create(ctx context.Context, params CreateSpendRequestParams) (*SpendRequest, error) {
	var result SpendRequest
	if err := r.base.doJSON(ctx, "create spend request", http.MethodPost, r.base.baseURL+"/spend_requests", params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Update changes mutable fields on a spend request.
func (r *SpendRequestsResource) Update(ctx context.Context, id string, params UpdateSpendRequestParams) (*SpendRequest, error) {
	var result SpendRequest
	endpoint := r.base.baseURL + "/spend_requests/" + url.PathEscape(id)
	if err := r.base.doJSON(ctx, "update spend request", http.MethodPost, endpoint, params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// RequestApproval asks the Link user to approve a spend request.
func (r *SpendRequestsResource) RequestApproval(ctx context.Context, id string) (*RequestApprovalResponse, error) {
	var response struct {
		ID           string `json:"id"`
		ApprovalLink string `json:"approval_link"`
	}
	endpoint := r.base.baseURL + "/spend_requests/" + url.PathEscape(id) + "/request_approval"
	apiResponse, err := r.base.fetch(ctx, http.MethodPost, endpoint, nil, nil)
	if err != nil {
		return nil, err
	}
	if apiResponse.status < 200 || apiResponse.status >= 300 {
		return nil, newAPIError("request approval", apiResponse.status, apiResponse.data, apiResponse.rawBody)
	}
	if err := decodeResponse("request approval", apiResponse, &response); err != nil {
		return nil, err
	}
	if response.ID == "" || response.ApprovalLink == "" {
		return nil, newResponseError("request approval", apiResponse.status, errors.New("response is missing id or approval_link"))
	}
	return &RequestApprovalResponse{ID: response.ID, ApprovalURL: response.ApprovalLink}, nil
}

// Cancel cancels a spend request.
func (r *SpendRequestsResource) Cancel(ctx context.Context, id string) (*SpendRequest, error) {
	var result SpendRequest
	endpoint := r.base.baseURL + "/spend_requests/" + url.PathEscape(id) + "/cancel"
	if err := r.base.doJSON(ctx, "cancel spend request", http.MethodPost, endpoint, nil, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Retrieve returns a spend request. A missing request returns (nil, nil).
func (r *SpendRequestsResource) Retrieve(ctx context.Context, id string, params *RetrieveSpendRequestParams) (*SpendRequest, error) {
	endpoint, err := url.Parse(r.base.baseURL + "/spend_requests/" + url.PathEscape(id))
	if err != nil {
		return nil, newConfigurationError("Invalid spend request URL: " + err.Error())
	}
	if params != nil && len(params.Include) > 0 {
		query := endpoint.Query()
		query.Set("include", strings.Join(params.Include, ","))
		endpoint.RawQuery = query.Encode()
	}
	response, err := r.base.fetch(ctx, http.MethodGet, endpoint.String(), nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status == http.StatusNotFound {
		return nil, nil
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("retrieve spend request", response.status, response.data, response.rawBody)
	}
	var result SpendRequest
	if err := decodeResponse("retrieve spend request", response, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
