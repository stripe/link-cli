"""Link response models. Amounts are integers; API timestamps remain strings."""

from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ._types import (
    AgentWalletVerificationStatus,
    ApprovalMethod,
    AuthenticationMethod,
    BalanceType,
    CredentialType,
    DeviceType,
    NextActionResolution,
    NextActionType,
    PaymentOutcome,
    SpendRequestStatus,
    TransactionOrigin,
)


class LinkModel(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(
        strict=True, extra="ignore", hide_input_in_errors=True
    )


class Total(LinkModel):
    type: str
    display_text: str
    amount: int


class LineItem(LinkModel):
    name: str
    url: str | None = None
    image_url: str | None = None
    description: str | None = None
    sku: str | None = None
    totals: list[Total] | None = None
    quantity: int | None = None
    unit_amount: int | None = None
    product_url: str | None = None


class BillingAddress(LinkModel):
    name: str
    line1: str
    line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str


class Card(LinkModel):
    id: str = Field(min_length=1)
    brand: str
    exp_month: int
    exp_year: int
    number: str = Field(repr=False)
    cvc: str | None = Field(default=None, repr=False)
    billing_address: BillingAddress | None = None
    valid_until: str | None = None


class NextAction(LinkModel):
    type: NextActionType | str
    resolution: NextActionResolution | str
    display_message: str
    action_url: str | None
    expires_at: int | None = None


class RequiresActionDetails(LinkModel):
    failure_code: str | None = None
    next_action: NextAction


class SpendRequestStatusDetails(LinkModel):
    requires_action: RequiresActionDetails | None = None


class ApprovalDetail(LinkModel):
    approved_at: int
    approval_method: ApprovalMethod | str
    app_name: str
    external_user_id: str
    ip_address: str | None = None
    user_agent: str | None = None
    device_type: DeviceType | str | None = None
    agent_log_id: str | None = None
    external_user_name: str | None = None
    external_session_id: str | None = None
    authentication_method: AuthenticationMethod | str | None = None


class SharedPaymentToken(LinkModel):
    id: str = Field(min_length=1, repr=False)
    billing_address: BillingAddress | None = None
    valid_until: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _legacy_string(cls, value: Any) -> Any:
        if isinstance(value, str):
            return {"id": value}
        return value


class RefundDetails(LinkModel):
    amount: int
    currency: str
    state: str
    created: int


class PaymentStatusDetails(LinkModel):
    outcome: PaymentOutcome | str
    code: str | None = None
    decline_code: str | None = None
    amount: int
    currency: str
    created: int | None = None
    refund_details: RefundDetails | None = None


class SpendRequest(LinkModel):
    id: str = Field(min_length=1)
    merchant_name: str | None = None
    merchant_url: str | None = None
    context: str | None = None
    amount: int | None = None
    currency: str | None = None
    line_items: list[LineItem] | None = None
    totals: list[Total] | None = None
    payment_method: str | None = None
    payment_details: str | None = None
    credential_type: CredentialType | str | None = None
    network_id: str | None = None
    card_brand: str | None = None
    card_last4: str | None = None
    status: SpendRequestStatus
    approval_url: str | None = None
    card: Card | None = None
    shared_payment_token: SharedPaymentToken | None = None
    link_pay_token: str | None = Field(default=None, repr=False)
    payment_status_details: PaymentStatusDetails | None = None
    status_details: SpendRequestStatusDetails | None = None
    link_transaction_id: str | None = None
    activity_url: str | None = None
    metadata: dict[str, str] | None = None
    expires_at: int | None = None
    created_at: str
    updated_at: str


class RequestApprovalResponse(LinkModel):
    id: str = Field(min_length=1)
    approval_url: str


class CardDetails(LinkModel):
    brand: str
    last4: str
    exp_month: int
    exp_year: int


class BankAccountDetails(LinkModel):
    last4: str
    bank_name: str | None = None


class SpendLimit(LinkModel):
    """A null limit means unlimited; missing user enrichment is separate."""

    limit: int | None


class RollingSpendLimit(LinkModel):
    limit: int | None
    used: int
    remaining: int | None


class AgentWalletSpendLimits(LinkModel):
    per_transaction: SpendLimit
    daily: RollingSpendLimit
    thirty_day: RollingSpendLimit


class AgentWalletVerificationRequirement(LinkModel):
    status: AgentWalletVerificationStatus | str
    action_url: str | None


class UserInfo(LinkModel):
    email: str | None = None
    name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    agent_wallet_spend_limits: AgentWalletSpendLimits | None = None
    agent_wallet_verification_requirement: AgentWalletVerificationRequirement | None = (
        None
    )


class ProductCapability(LinkModel):
    eligible: bool
    ineligibility_reasons: list[str]


class PaymentMethod(LinkModel):
    id: str = Field(min_length=1)
    type: str
    is_default: bool
    name: str
    nickname: str | None = None
    card_details: CardDetails | None = None
    bank_account_details: BankAccountDetails | None = None
    capabilities: dict[str, ProductCapability] | None = None


class ShippingAddress(LinkModel):
    name: str | None = None
    line_1: str | None = None
    line_2: str | None = None
    locality: str | None = None
    dependent_locality: str | None = None
    administrative_area: str | None = None
    postal_code: str | None = None
    sorting_code: str | None = None
    country_code: str | None = None


class ShippingAddressRecord(LinkModel):
    id: str = Field(min_length=1)
    is_default: bool
    nickname: str | None = None
    address: ShippingAddress | None


class Transaction(LinkModel):
    id: str = Field(min_length=1)
    source_id: str | None
    amount: int
    currency: str
    created_date: str
    description: str
    origin: TransactionOrigin | str
    category: str | None
    status: str


class TransactionsPage(LinkModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")
    data: list[Transaction]
    has_more: bool | None = None


class Source(LinkModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")
    id: str | None = None
    name: str | None = None
    type: str | None = None
    capabilities: dict[str, Any] | None = None
    external_connection: dict[str, Any] | None = None
    granted_actions: list[str] | None = None
    bank_account: dict[str, Any] | None = None
    card: dict[str, Any] | None = None


class SourcesPage(LinkModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")
    data: list[Source]
    has_more: bool | None = None


class CashBalance(LinkModel):
    available: dict[str, int]


class CreditBalance(LinkModel):
    used: dict[str, int]


class Balance(LinkModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")
    source_id: str
    type: BalanceType | str
    cash: CashBalance | None = None
    credit: CreditBalance | None = None
    current: int
    currency: str
    as_of: str


class BalancesPage(LinkModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")
    data: list[Balance]
    has_more: bool | None = None


class WebBotAuthBlock(LinkModel):
    signature: str
    signature_input: str
    signature_agent: str
    authority: str
    expires_at: str


class ReportRecord(LinkModel):
    object: str
    created_at: str
    domain: str
    outcome: str
    spend_request_id: str
    status: str
