package link

import (
	"encoding/json"
	"errors"
)

// JSONPrimitive represents a JSON primitive value.
type JSONPrimitive = any

// JSONValue represents any JSON-compatible value.
type JSONValue = any

// LineItem describes an item in a purchase.
type LineItem struct {
	Name        string  `json:"name"`
	URL         *string `json:"url,omitempty"`
	ImageURL    *string `json:"image_url,omitempty"`
	Description *string `json:"description,omitempty"`
	SKU         *string `json:"sku,omitempty"`
	Totals      []Total `json:"totals,omitempty"`
	Quantity    *int64  `json:"quantity,omitempty"`
	UnitAmount  *int64  `json:"unit_amount,omitempty"`
	ProductURL  *string `json:"product_url,omitempty"`
}

func (item LineItem) MarshalJSON() ([]byte, error) {
	type wire LineItem
	present := make(map[string]any)
	if item.Totals != nil {
		present["totals"] = item.Totals
	}
	return marshalExtra(wire(item), present)
}

// Total describes a displayed purchase total.
type Total struct {
	Type        string `json:"type"`
	DisplayText string `json:"display_text"`
	Amount      int64  `json:"amount"`
}

// BillingAddress contains billing-address fields returned with credentials.
type BillingAddress struct {
	Name       string  `json:"name"`
	Line1      string  `json:"line1"`
	Line2      *string `json:"line2,omitempty"`
	City       *string `json:"city,omitempty"`
	State      *string `json:"state,omitempty"`
	PostalCode *string `json:"postal_code,omitempty"`
	Country    string  `json:"country"`
}

// Card contains a short-lived virtual-card credential.
type Card struct {
	ID             string          `json:"id"`
	Brand          string          `json:"brand"`
	ExpMonth       int64           `json:"exp_month"`
	ExpYear        int64           `json:"exp_year"`
	Number         string          `json:"number"`
	CVC            *string         `json:"cvc,omitempty"`
	BillingAddress *BillingAddress `json:"billing_address,omitempty"`
	ValidUntil     *string         `json:"valid_until,omitempty"`
}

// SpendRequestStatus is a spend-request lifecycle state. Unknown future values
// remain representable for forward compatibility.
type SpendRequestStatus string

const (
	SpendRequestStatusCreated         SpendRequestStatus = "created"
	SpendRequestStatusPendingApproval SpendRequestStatus = "pending_approval"
	SpendRequestStatusExpired         SpendRequestStatus = "expired"
	SpendRequestStatusApproved        SpendRequestStatus = "approved"
	SpendRequestStatusDenied          SpendRequestStatus = "denied"
	SpendRequestStatusSucceeded       SpendRequestStatus = "succeeded"
	SpendRequestStatusFailed          SpendRequestStatus = "failed"
	SpendRequestStatusCanceled        SpendRequestStatus = "canceled"
	SpendRequestStatusRequiresAction  SpendRequestStatus = "requires_action"
)

// NextActionType identifies an action required from the user.
type NextActionType string

const (
	NextActionTypeSSNVerification      NextActionType = "ssn_verification"
	NextActionTypeIdentityVerification NextActionType = "identity_verification"
	NextActionTypeContactSupport       NextActionType = "contact_support"
	NextActionTypeSelectPaymentMethod  NextActionType = "select_payment_method"
	NextActionTypeAddPaymentMethod     NextActionType = "add_payment_method"
	NextActionTypeUpdatePaymentMethod  NextActionType = "update_payment_method"
	NextActionTypeReauthorize          NextActionType = "re_authorize"
	NextActionTypeThreeDSecure         NextActionType = "three_d_secure"
	NextActionTypeThreeDSecureRetry    NextActionType = "three_d_secure_retry"
)

// NextActionResolution describes how an agent should proceed after an action.
type NextActionResolution string

const (
	NextActionResolutionAutoResume                     NextActionResolution = "auto_resume"
	NextActionResolutionCreateNewSpendRequest          NextActionResolution = "create_new_spend_request"
	NextActionResolutionCreateNewAfterActionCompletion NextActionResolution = "create_new_spend_request_after_completion"
)

// NextAction describes required user action for a spend request.
type NextAction struct {
	Type           NextActionType       `json:"type"`
	Resolution     NextActionResolution `json:"resolution"`
	DisplayMessage string               `json:"display_message"`
	ActionURL      *string              `json:"action_url"`
	ExpiresAt      *int64               `json:"expires_at,omitempty"`
}

// RequiresActionDetails contains details for a requires_action status.
type RequiresActionDetails struct {
	FailureCode *string    `json:"failure_code,omitempty"`
	NextAction  NextAction `json:"next_action"`
}

// SpendRequestStatusDetails contains status-specific information.
type SpendRequestStatusDetails struct {
	RequiresAction *RequiresActionDetails `json:"requires_action,omitempty"`
}

// CredentialType identifies the credential requested for an approved purchase.
type CredentialType string

const (
	CredentialTypeSharedPaymentToken CredentialType = "shared_payment_token"
	CredentialTypeCard               CredentialType = "card"
)

// ApprovalMethod describes how delegated approval was obtained.
type ApprovalMethod string

const (
	ApprovalMethodClick        ApprovalMethod = "click"
	ApprovalMethodProgrammatic ApprovalMethod = "programmatic"
	ApprovalMethodVoice        ApprovalMethod = "voice"
)

// DeviceType identifies the device used for delegated approval.
type DeviceType string

const (
	DeviceTypeMobile DeviceType = "mobile"
	DeviceTypeWeb    DeviceType = "web"
)

// AuthenticationMethod identifies the user-authentication mechanism.
type AuthenticationMethod string

const (
	AuthenticationMethodBiometricFace        AuthenticationMethod = "biometric_face"
	AuthenticationMethodBiometricFingerprint AuthenticationMethod = "biometric_fingerprint"
	AuthenticationMethodPasskey              AuthenticationMethod = "passkey"
)

// ApprovalDetail records delegated-approval evidence.
type ApprovalDetail struct {
	ApprovedAt           int64                 `json:"approved_at"`
	ApprovalMethod       ApprovalMethod        `json:"approval_method"`
	AppName              string                `json:"app_name"`
	ExternalUserID       string                `json:"external_user_id"`
	IPAddress            *string               `json:"ip_address,omitempty"`
	UserAgent            *string               `json:"user_agent,omitempty"`
	DeviceType           *DeviceType           `json:"device_type,omitempty"`
	AgentLogID           *string               `json:"agent_log_id,omitempty"`
	ExternalUserName     *string               `json:"external_user_name,omitempty"`
	ExternalSessionID    *string               `json:"external_session_id,omitempty"`
	AuthenticationMethod *AuthenticationMethod `json:"authentication_method,omitempty"`
}

// SharedPaymentToken contains a short-lived shared payment token.
type SharedPaymentToken struct {
	ID             string          `json:"id"`
	BillingAddress *BillingAddress `json:"billing_address,omitempty"`
	ValidUntil     *string         `json:"valid_until,omitempty"`
}

// UnmarshalJSON accepts the legacy string representation returned by older APIs.
func (s *SharedPaymentToken) UnmarshalJSON(data []byte) error {
	*s = SharedPaymentToken{}
	var id string
	if err := json.Unmarshal(data, &id); err == nil {
		s.ID = id
		return nil
	}
	type sharedPaymentToken SharedPaymentToken
	var decoded sharedPaymentToken
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if decoded.ID == "" {
		return errors.New("shared payment token response is missing id")
	}
	*s = SharedPaymentToken(decoded)
	return nil
}

// RefundDetails describes a refund associated with a payment.
type RefundDetails struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	State    string `json:"state"`
	Created  int64  `json:"created"`
}

// PaymentOutcome identifies whether payment execution succeeded.
type PaymentOutcome string

const (
	PaymentOutcomeSuccess PaymentOutcome = "success"
	PaymentOutcomeFailure PaymentOutcome = "failure"
)

// PaymentStatusDetails contains execution details for a spend request.
type PaymentStatusDetails struct {
	Outcome       PaymentOutcome `json:"outcome"`
	Code          *string        `json:"code,omitempty"`
	DeclineCode   *string        `json:"decline_code,omitempty"`
	Amount        int64          `json:"amount"`
	Currency      string         `json:"currency"`
	Created       *int64         `json:"created,omitempty"`
	RefundDetails *RefundDetails `json:"refund_details,omitempty"`
}

// SpendRequest represents a Link spend request and any issued credential.
type SpendRequest struct {
	ID                   string                     `json:"id"`
	MerchantName         *string                    `json:"merchant_name,omitempty"`
	MerchantURL          *string                    `json:"merchant_url,omitempty"`
	Context              *string                    `json:"context,omitempty"`
	Amount               *int64                     `json:"amount,omitempty"`
	Currency             *string                    `json:"currency,omitempty"`
	LineItems            []LineItem                 `json:"line_items,omitempty"`
	Totals               []Total                    `json:"totals,omitempty"`
	PaymentMethod        *string                    `json:"payment_method,omitempty"`
	PaymentDetails       *string                    `json:"payment_details,omitempty"`
	CredentialType       *CredentialType            `json:"credential_type,omitempty"`
	NetworkID            *string                    `json:"network_id,omitempty"`
	CardBrand            *string                    `json:"card_brand,omitempty"`
	CardLast4            *string                    `json:"card_last4,omitempty"`
	Status               SpendRequestStatus         `json:"status"`
	ApprovalURL          *string                    `json:"approval_url,omitempty"`
	Card                 *Card                      `json:"card,omitempty"`
	SharedPaymentToken   *SharedPaymentToken        `json:"shared_payment_token,omitempty"`
	LinkPayToken         *string                    `json:"link_pay_token,omitempty"`
	PaymentStatusDetails *PaymentStatusDetails      `json:"payment_status_details,omitempty"`
	StatusDetails        *SpendRequestStatusDetails `json:"status_details,omitempty"`
	LinkTransactionID    *string                    `json:"link_transaction_id,omitempty"`
	ActivityURL          *string                    `json:"activity_url,omitempty"`
	Metadata             map[string]string          `json:"metadata,omitempty"`
	ExpiresAt            *int64                     `json:"expires_at,omitempty"`
	CreatedAt            string                     `json:"created_at"`
	UpdatedAt            string                     `json:"updated_at"`
}

// MarshalJSON preserves explicitly present empty collections returned by Link.
func (request SpendRequest) MarshalJSON() ([]byte, error) {
	type wire SpendRequest
	present := make(map[string]any)
	if request.LineItems != nil {
		present["line_items"] = request.LineItems
	}
	if request.Totals != nil {
		present["totals"] = request.Totals
	}
	if request.Metadata != nil {
		present["metadata"] = request.Metadata
	}
	return marshalExtra(wire(request), present)
}

// RequestApprovalResponse contains the URL where a user can approve a request.
type RequestApprovalResponse struct {
	ID          string `json:"id"`
	ApprovalURL string `json:"approval_url"`
}

// CardDetails contains non-sensitive saved-card details.
type CardDetails struct {
	Brand    string `json:"brand"`
	Last4    string `json:"last4"`
	ExpMonth int64  `json:"exp_month"`
	ExpYear  int64  `json:"exp_year"`
}

// BankAccountDetails contains non-sensitive saved-bank-account details.
type BankAccountDetails struct {
	Last4    string  `json:"last4"`
	BankName *string `json:"bank_name,omitempty"`
}

// AgentWalletVerificationStatus identifies the user's verification state.
type AgentWalletVerificationStatus string

const (
	AgentWalletVerificationStatusNotRequired          AgentWalletVerificationStatus = "not_required"
	AgentWalletVerificationStatusSSNVerification      AgentWalletVerificationStatus = "ssn_verification"
	AgentWalletVerificationStatusIdentityVerification AgentWalletVerificationStatus = "identity_verification"
	AgentWalletVerificationStatusContactSupport       AgentWalletVerificationStatus = "contact_support"
	AgentWalletVerificationStatusComplete             AgentWalletVerificationStatus = "complete"
)

// SpendLimit contains a nullable limit; nil means unlimited.
type SpendLimit struct {
	Limit *int64 `json:"limit"`
}

// RollingSpendLimit contains usage within a rolling period.
type RollingSpendLimit struct {
	Limit     *int64 `json:"limit"`
	Used      int64  `json:"used"`
	Remaining *int64 `json:"remaining"`
}

// AgentWalletSpendLimits contains per-transaction and rolling spend limits.
type AgentWalletSpendLimits struct {
	PerTransaction SpendLimit        `json:"per_transaction"`
	Daily          RollingSpendLimit `json:"daily"`
	ThirtyDay      RollingSpendLimit `json:"thirty_day"`
}

// AgentWalletVerificationRequirement describes a required verification action.
type AgentWalletVerificationRequirement struct {
	Status    AgentWalletVerificationStatus `json:"status"`
	ActionURL *string                       `json:"action_url"`
}

// UserInfo contains identity and optional Agent Wallet enrichment fields.
type UserInfo struct {
	Email                              *string                             `json:"email,omitempty"`
	Name                               *string                             `json:"name,omitempty"`
	FirstName                          *string                             `json:"first_name,omitempty"`
	LastName                           *string                             `json:"last_name,omitempty"`
	Phone                              *string                             `json:"phone,omitempty"`
	AgentWalletSpendLimits             *AgentWalletSpendLimits             `json:"agent_wallet_spend_limits,omitempty"`
	AgentWalletVerificationRequirement *AgentWalletVerificationRequirement `json:"agent_wallet_verification_requirement,omitempty"`
}

// ProductCapability describes eligibility for a payment capability.
type ProductCapability struct {
	Eligible             bool     `json:"eligible"`
	IneligibilityReasons []string `json:"ineligibility_reasons"`
}

// PaymentMethod represents a saved Link payment method.
type PaymentMethod struct {
	ID                 string                       `json:"id"`
	Type               string                       `json:"type"`
	IsDefault          bool                         `json:"is_default"`
	Name               string                       `json:"name"`
	Nickname           *string                      `json:"nickname,omitempty"`
	CardDetails        *CardDetails                 `json:"card_details,omitempty"`
	BankAccountDetails *BankAccountDetails          `json:"bank_account_details,omitempty"`
	Capabilities       map[string]ProductCapability `json:"capabilities,omitempty"`
}

// ShippingAddress contains nullable postal-address fields.
type ShippingAddress struct {
	Name               *string `json:"name"`
	Line1              *string `json:"line_1"`
	Line2              *string `json:"line_2"`
	Locality           *string `json:"locality"`
	DependentLocality  *string `json:"dependent_locality"`
	AdministrativeArea *string `json:"administrative_area"`
	PostalCode         *string `json:"postal_code"`
	SortingCode        *string `json:"sorting_code"`
	CountryCode        *string `json:"country_code"`
}

// ShippingAddressRecord represents a saved Link shipping address.
type ShippingAddressRecord struct {
	ID        string           `json:"id"`
	IsDefault bool             `json:"is_default"`
	Nickname  *string          `json:"nickname"`
	Address   *ShippingAddress `json:"address"`
}

// TransactionOrigin identifies where a transaction originated.
type TransactionOrigin string

const (
	TransactionOriginLink               TransactionOrigin = "link"
	TransactionOriginExternalConnection TransactionOrigin = "external_connection"
)

// Transaction represents a Link or externally connected transaction.
type Transaction struct {
	ID          string            `json:"id"`
	SourceID    *string           `json:"source_id"`
	Amount      int64             `json:"amount"`
	Currency    string            `json:"currency"`
	CreatedDate string            `json:"created_date"`
	Description string            `json:"description"`
	Origin      TransactionOrigin `json:"origin"`
	Category    *string           `json:"category"`
	Status      string            `json:"status"`
}

// TransactionsPage is a page of transactions. AdditionalFields preserves
// forward-compatible response properties not yet modeled by the SDK.
type TransactionsPage struct {
	Data             []Transaction  `json:"data"`
	HasMore          *bool          `json:"has_more,omitempty"`
	AdditionalFields map[string]any `json:"-"`
}

// Source represents a connected financial source. AdditionalFields preserves
// forward-compatible response properties not yet modeled by the SDK.
type Source struct {
	ID                 *string        `json:"id,omitempty"`
	Name               *string        `json:"name,omitempty"`
	Type               *string        `json:"type,omitempty"`
	Capabilities       map[string]any `json:"capabilities,omitempty"`
	ExternalConnection map[string]any `json:"external_connection,omitempty"`
	GrantedActions     []string       `json:"granted_actions,omitempty"`
	BankAccount        map[string]any `json:"bank_account,omitempty"`
	Card               map[string]any `json:"card,omitempty"`
	AdditionalFields   map[string]any `json:"-"`
}

// SourcesPage is a page of connected sources.
type SourcesPage struct {
	Data             []Source       `json:"data"`
	HasMore          *bool          `json:"has_more,omitempty"`
	AdditionalFields map[string]any `json:"-"`
}

// CashBalance contains available amounts by currency.
type CashBalance struct {
	Available map[string]int64 `json:"available"`
}

// CreditBalance contains used amounts by currency.
type CreditBalance struct {
	Used map[string]int64 `json:"used"`
}

// BalanceType identifies a cash or credit balance.
type BalanceType string

const (
	BalanceTypeCash   BalanceType = "cash"
	BalanceTypeCredit BalanceType = "credit"
)

// Balance represents a source balance.
type Balance struct {
	SourceID         string         `json:"source_id"`
	Type             BalanceType    `json:"type"`
	Cash             *CashBalance   `json:"cash,omitempty"`
	Credit           *CreditBalance `json:"credit,omitempty"`
	Current          int64          `json:"current"`
	Currency         string         `json:"currency"`
	AsOf             string         `json:"as_of"`
	AdditionalFields map[string]any `json:"-"`
}

// BalancesPage is a page of balances.
type BalancesPage struct {
	Data             []Balance      `json:"data"`
	HasMore          *bool          `json:"has_more,omitempty"`
	AdditionalFields map[string]any `json:"-"`
}

// WebBotAuthBlock contains HTTP message-signature fields for an authority.
type WebBotAuthBlock struct {
	Signature      string `json:"signature"`
	SignatureInput string `json:"signature_input"`
	SignatureAgent string `json:"signature_agent"`
	Authority      string `json:"authority"`
	ExpiresAt      string `json:"expires_at"`
}
