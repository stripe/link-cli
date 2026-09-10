package link

import (
	"context"
	"net/http"
)

// UserInfoResource provides Link user-information operations.
type UserInfoResource struct {
	base *baseResource
}

// Retrieve returns information about the authenticated Link user.
func (r *UserInfoResource) Retrieve(ctx context.Context) (*UserInfo, error) {
	response, err := r.base.fetch(ctx, http.MethodGet, r.base.baseURL+"/userinfo", nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("retrieve user info", response.status, response.data, response.rawBody)
	}
	var wire struct {
		Email                  *string                             `json:"email"`
		Name                   *string                             `json:"name"`
		FirstName              *string                             `json:"first_name"`
		LastName               *string                             `json:"last_name"`
		Phone                  *string                             `json:"phone"`
		AgentWalletSpendLimits *AgentWalletSpendLimits             `json:"agent_wallet_spend_limits,omitempty"`
		AgentWalletStepUp      *AgentWalletVerificationRequirement `json:"agent_wallet_step_up,omitempty"`
	}
	if err := decodeResponse("retrieve user info", response, &wire); err != nil {
		return nil, err
	}
	return &UserInfo{
		Email:                              wire.Email,
		Name:                               wire.Name,
		FirstName:                          wire.FirstName,
		LastName:                           wire.LastName,
		Phone:                              wire.Phone,
		AgentWalletSpendLimits:             wire.AgentWalletSpendLimits,
		AgentWalletVerificationRequirement: wire.AgentWalletStepUp,
	}, nil
}
