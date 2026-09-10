package link

import (
	"context"
	"net/http"
)

// ReportsResource provides agent-observation reporting operations.
type ReportsResource struct {
	base *baseResource
}

// Create records an agent outcome.
func (r *ReportsResource) Create(ctx context.Context, params CreateReportParams) (*ReportRecord, error) {
	var result ReportRecord
	if err := r.base.doJSON(
		ctx,
		"create report",
		http.MethodPost,
		r.base.baseURL+"/agent_observations",
		params,
		&result,
	); err != nil {
		return nil, err
	}
	return &result, nil
}
