package link

// GetAccessTokenOptions describes why an access token is being requested.
type GetAccessTokenOptions struct {
	ForceRefresh bool
}

// ExecutionMethod identifies how an approved credential will be executed.
type ExecutionMethod string

const ExecutionMethodLinkPayToken ExecutionMethod = "link_pay_token"

// CreateSpendRequestParams contains fields accepted when creating a spend request.
type CreateSpendRequestParams struct {
	IdempotencyKey    *string           `json:"idempotency_key,omitempty"`
	PaymentDetails    *string           `json:"payment_details,omitempty"`
	CredentialType    *CredentialType   `json:"credential_type,omitempty"`
	NetworkID         *string           `json:"network_id,omitempty"`
	ExecutionMethod   *ExecutionMethod  `json:"execution_method,omitempty"`
	MerchantAccountID *string           `json:"merchant_account_id,omitempty"`
	Amount            *int64            `json:"amount,omitempty"`
	Currency          *string           `json:"currency,omitempty"`
	MerchantName      *string           `json:"merchant_name,omitempty"`
	MerchantURL       *string           `json:"merchant_url,omitempty"`
	Context           string            `json:"context"`
	LineItems         []LineItem        `json:"line_items,omitempty"`
	Totals            []Total           `json:"totals,omitempty"`
	RequestApproval   *bool             `json:"request_approval,omitempty"`
	Test              *bool             `json:"test,omitempty"`
	ApprovalDetails   *ApprovalDetail   `json:"approval_details,omitempty"`
	Metadata          map[string]string `json:"metadata,omitempty"`
}

func (params CreateSpendRequestParams) MarshalJSON() ([]byte, error) {
	type wire CreateSpendRequestParams
	present := make(map[string]any)
	if params.LineItems != nil {
		present["line_items"] = params.LineItems
	}
	if params.Totals != nil {
		present["totals"] = params.Totals
	}
	if params.Metadata != nil {
		present["metadata"] = params.Metadata
	}
	return marshalExtra(wire(params), present)
}

// UpdateSpendRequestParams contains mutable spend-request fields. Non-nil empty
// slices are encoded as empty arrays so callers can clear line items and totals.
type UpdateSpendRequestParams struct {
	PaymentDetails *string    `json:"payment_details,omitempty"`
	Amount         *int64     `json:"amount,omitempty"`
	MerchantURL    *string    `json:"merchant_url,omitempty"`
	ProfileID      *string    `json:"profile_id,omitempty"`
	MerchantID     *string    `json:"merchant_id,omitempty"`
	Currency       *string    `json:"currency,omitempty"`
	LineItems      []LineItem `json:"line_items,omitempty"`
	Totals         []Total    `json:"totals,omitempty"`
}

func (params UpdateSpendRequestParams) MarshalJSON() ([]byte, error) {
	type wire UpdateSpendRequestParams
	present := make(map[string]any)
	if params.LineItems != nil {
		present["line_items"] = params.LineItems
	}
	if params.Totals != nil {
		present["totals"] = params.Totals
	}
	return marshalExtra(wire(params), present)
}

// ListSpendRequestsParams controls spend-request listing.
type ListSpendRequestsParams struct {
	IncludeHistory bool
}

// RetrieveSpendRequestParams controls expandable retrieve fields.
type RetrieveSpendRequestParams struct {
	Include []string
}

// ListTransactionsParams filters and paginates transactions.
type ListTransactionsParams struct {
	Limit         *int64             `json:"limit,omitempty"`
	StartingAfter *string            `json:"starting_after,omitempty"`
	EndingBefore  *string            `json:"ending_before,omitempty"`
	StartDate     *string            `json:"start_date,omitempty"`
	EndDate       *string            `json:"end_date,omitempty"`
	Category      *string            `json:"category,omitempty"`
	Origin        *TransactionOrigin `json:"origin,omitempty"`
	Sources       []string           `json:"sources,omitempty"`
}

// ListSourcesParams paginates connected sources.
type ListSourcesParams struct {
	Limit         *int64  `json:"limit,omitempty"`
	StartingAfter *string `json:"starting_after,omitempty"`
	EndingBefore  *string `json:"ending_before,omitempty"`
}

// ListBalancesParams filters and paginates balances.
type ListBalancesParams struct {
	Sources       []string `json:"sources,omitempty"`
	Limit         *int64   `json:"limit,omitempty"`
	StartingAfter *string  `json:"starting_after,omitempty"`
	EndingBefore  *string  `json:"ending_before,omitempty"`
}

// ReportOutcome is the result of an agent attempt.
type ReportOutcome string

const (
	ReportOutcomeSuccess   ReportOutcome = "success"
	ReportOutcomeBlocked   ReportOutcome = "blocked"
	ReportOutcomeAbandoned ReportOutcome = "abandoned"
)

// ReportTag categorizes an observed agent outcome.
type ReportTag string

const (
	ReportTagStripeCheckout   ReportTag = "stripe_checkout"
	ReportTagCaptcha          ReportTag = "captcha"
	ReportTagAntiBotScript    ReportTag = "anti_bot_script"
	ReportTagCDNBlock         ReportTag = "cdn_block"
	ReportTagWAFBlock         ReportTag = "waf_block"
	ReportTagDNSBlock         ReportTag = "dns_block"
	ReportTagRateLimited      ReportTag = "rate_limited"
	ReportTagLoginRequired    ReportTag = "login_required"
	ReportTag3DSChallenge     ReportTag = "3ds_challenge"
	ReportTagPageInaccessible ReportTag = "page_inaccessible"
	ReportTagTimeout          ReportTag = "timeout"
	ReportTagSiteError        ReportTag = "site_error"
	ReportTagPaymentDeclined  ReportTag = "payment_declined"
	ReportTagOther            ReportTag = "other"
)

// CreateReportParams contains an agent-observation report.
type CreateReportParams struct {
	Domain          string        `json:"domain"`
	Outcome         ReportOutcome `json:"outcome"`
	SpendRequestID  string        `json:"spend_request_id"`
	Tags            []ReportTag   `json:"tags,omitempty"`
	Step            *string       `json:"step,omitempty"`
	FreeformContext *string       `json:"freeform_context,omitempty"`
}

func (params CreateReportParams) MarshalJSON() ([]byte, error) {
	type wire CreateReportParams
	present := make(map[string]any)
	if params.Tags != nil {
		present["tags"] = params.Tags
	}
	return marshalExtra(wire(params), present)
}

// ReportRecord is a persisted agent-observation report.
type ReportRecord struct {
	Object         string `json:"object"`
	CreatedAt      string `json:"created_at"`
	Domain         string `json:"domain"`
	Outcome        string `json:"outcome"`
	SpendRequestID string `json:"spend_request_id"`
	Status         string `json:"status"`
}
