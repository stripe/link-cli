package link

import (
	"context"
	"errors"
	"net/http"
)

// ApprovalPolicyAction identifies the action an approval rule applies to.
// Unknown future actions are preserved.
type ApprovalPolicyAction string

const ApprovalPolicyActionSpendRequestCreate ApprovalPolicyAction = "spend_request_create"

// ApprovalPolicyAmount is an amount in the currency's minor unit.
type ApprovalPolicyAmount struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// ApprovalPolicyLimits contains the limits that apply to a rule.
type ApprovalPolicyLimits struct {
	PerPurchase ApprovalPolicyAmount `json:"per_purchase"`
}

// ApprovalPolicyRule describes when an action is approved automatically.
type ApprovalPolicyRule struct {
	Action                ApprovalPolicyAction `json:"action"`
	Limits                ApprovalPolicyLimits `json:"limits"`
	AllowedPaymentMethods []string             `json:"allowed_payment_methods,omitempty"`
}

// ApprovalPolicy is the Link user's configured approval policy.
type ApprovalPolicy struct {
	Rules []ApprovalPolicyRule `json:"rules"`
}

// ApprovalPolicyResource provides approval-policy operations.
type ApprovalPolicyResource struct {
	base *baseResource
}

// Retrieve returns the configured approval policy.
func (r *ApprovalPolicyResource) Retrieve(ctx context.Context) (*ApprovalPolicy, error) {
	const operation = "retrieve approval policy"
	response, err := r.base.fetch(ctx, http.MethodGet, r.base.baseURL+"/approval-policy", nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError(operation, response.status, response.data, response.rawBody)
	}
	var wire struct {
		Rules *[]struct {
			Action *string `json:"action"`
			Limits *struct {
				PerPurchase *struct {
					Amount   *int64  `json:"amount"`
					Currency *string `json:"currency"`
				} `json:"per_purchase"`
			} `json:"limits"`
			AllowedPaymentMethods []string `json:"allowed_payment_methods"`
		} `json:"rules"`
	}
	if err := decodeResponse(operation, response, &wire); err != nil {
		return nil, err
	}
	if wire.Rules == nil {
		return nil, newResponseError(operation, response.status, errors.New("rules is required"))
	}
	policy := ApprovalPolicy{Rules: make([]ApprovalPolicyRule, 0, len(*wire.Rules))}
	for _, rule := range *wire.Rules {
		if rule.Action == nil || rule.Limits == nil || rule.Limits.PerPurchase == nil ||
			rule.Limits.PerPurchase.Amount == nil || rule.Limits.PerPurchase.Currency == nil {
			return nil, newResponseError(operation, response.status, errors.New("rule is missing action or per-purchase limit"))
		}
		policy.Rules = append(policy.Rules, ApprovalPolicyRule{
			Action: ApprovalPolicyAction(*rule.Action),
			Limits: ApprovalPolicyLimits{PerPurchase: ApprovalPolicyAmount{
				Amount:   *rule.Limits.PerPurchase.Amount,
				Currency: *rule.Limits.PerPurchase.Currency,
			}},
			AllowedPaymentMethods: rule.AllowedPaymentMethods,
		})
	}
	return &policy, nil
}
