"""Public JSON types and known API string values."""

from typing import Literal, TypeAlias

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]

# Response statuses remain open to future API values, as in TypeScript and Go.
SpendRequestStatus: TypeAlias = (
    Literal[
        "created",
        "pending_approval",
        "expired",
        "approved",
        "denied",
        "submitted",
        "succeeded",
        "failed",
        "canceled",
        "requires_action",
    ]
    | str
)
NextActionType: TypeAlias = Literal[
    "ssn_verification",
    "identity_verification",
    "contact_support",
    "select_payment_method",
    "add_payment_method",
    "update_payment_method",
    "re_authorize",
    "three_d_secure",
    "three_d_secure_retry",
]
NextActionResolution: TypeAlias = Literal[
    "auto_resume",
    "create_new_spend_request",
    "create_new_spend_request_after_completion",
]
CredentialType: TypeAlias = Literal["shared_payment_token", "card"]
ApprovalMethod: TypeAlias = Literal["click", "programmatic", "voice"]
DeviceType: TypeAlias = Literal["mobile", "web"]
AuthenticationMethod: TypeAlias = Literal[
    "biometric_face",
    "biometric_fingerprint",
    "passkey",
]
ExecutionMethod: TypeAlias = Literal["link_pay_token"]
PaymentOutcome: TypeAlias = Literal["success", "failure"]
AgentWalletVerificationStatus: TypeAlias = Literal[
    "not_required",
    "ssn_verification",
    "identity_verification",
    "contact_support",
    "complete",
]
TransactionOrigin: TypeAlias = Literal["link", "external_connection"]
BalanceType: TypeAlias = Literal["cash", "credit"]
ReportOutcome: TypeAlias = Literal["success", "blocked", "abandoned"]
ReportTag: TypeAlias = Literal[
    "stripe_checkout",
    "captcha",
    "anti_bot_script",
    "cdn_block",
    "waf_block",
    "dns_block",
    "rate_limited",
    "login_required",
    "3ds_challenge",
    "page_inaccessible",
    "timeout",
    "site_error",
    "payment_declined",
    "other",
]
