package link

import (
	"context"
	"net/http"
)

// ShippingAddressesResource provides shipping-address operations.
type ShippingAddressesResource struct {
	base *baseResource
}

// List returns shipping addresses saved to the Link account.
func (r *ShippingAddressesResource) List(ctx context.Context) ([]ShippingAddressRecord, error) {
	response, err := r.base.fetch(ctx, http.MethodGet, r.base.baseURL+"/shipping_addresses", nil, nil)
	if err != nil {
		return nil, err
	}
	if response.status < 200 || response.status >= 300 {
		return nil, newAPIError("list shipping addresses", response.status, response.data, response.rawBody)
	}
	var envelope struct {
		ShippingAddresses []ShippingAddressRecord `json:"shipping_addresses"`
	}
	if err := decodeResponse("list shipping addresses", response, &envelope); err != nil {
		return nil, err
	}
	return envelope.ShippingAddresses, nil
}
