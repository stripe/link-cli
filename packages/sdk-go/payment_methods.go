package link

import (
	"context"
	"net/http"
	"net/url"
)

// UpdatePaymentMethodParams contains mutable payment-method fields.
type UpdatePaymentMethodParams struct {
	Nickname string `json:"nickname"`
}

// PaymentMethodsResource provides payment-method operations.
type PaymentMethodsResource struct {
	base *baseResource
}

// List returns payment methods saved to the Link account.
func (r *PaymentMethodsResource) List(ctx context.Context) ([]PaymentMethod, error) {
	response, err := r.base.fetch(ctx, http.MethodGet, r.base.baseURL+"/payment-details", nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("list payment methods", response.status, response.data, response.rawBody)
	}
	var envelope struct {
		PaymentDetails []PaymentMethod `json:"payment_details"`
	}
	if err := decodeResponse("list payment methods", response, &envelope); err != nil {
		return nil, err
	}
	return envelope.PaymentDetails, nil
}

// Update sets, changes, or clears a payment-method nickname.
func (r *PaymentMethodsResource) Update(ctx context.Context, id string, params UpdatePaymentMethodParams) (*PaymentMethod, error) {
	var result PaymentMethod
	endpoint := r.base.baseURL + "/payment-details/" + url.PathEscape(id)
	if err := r.base.doJSON(ctx, "update payment method", http.MethodPost, endpoint, params, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
