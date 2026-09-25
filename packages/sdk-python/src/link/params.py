"""Typed request dictionaries, usable with resource keyword arguments."""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Required, TypedDict

from ._types import (
    ApprovalMethod,
    AuthenticationMethod,
    CredentialType,
    DeviceType,
    ExecutionMethod,
    ReportOutcome,
    ReportTag,
    TransactionOrigin,
)


@dataclass(frozen=True)
class GetAccessTokenOptions:
    force_refresh: bool = False


AccessTokenProvider = Callable[[GetAccessTokenOptions], str]
AsyncAccessTokenProvider = Callable[[GetAccessTokenOptions], str | Awaitable[str]]


class TotalParams(TypedDict):
    type: str
    display_text: str
    amount: int


class LineItemParams(TypedDict, total=False):
    name: Required[str]
    url: str | None
    image_url: str | None
    description: str | None
    sku: str | None
    totals: Sequence[TotalParams] | None
    quantity: int | None
    unit_amount: int | None
    product_url: str | None


class ApprovalDetailParams(TypedDict, total=False):
    approved_at: Required[int]
    approval_method: Required[ApprovalMethod]
    app_name: Required[str]
    external_user_id: Required[str]
    ip_address: str | None
    user_agent: str | None
    device_type: DeviceType | None
    agent_log_id: str | None
    external_user_name: str | None
    external_session_id: str | None
    authentication_method: AuthenticationMethod | None


class CreateSpendRequestParams(TypedDict, total=False):
    context: Required[str]
    idempotency_key: str | None
    payment_details: str | None
    credential_type: CredentialType | None
    network_id: str | None
    execution_method: ExecutionMethod | None
    merchant_account_id: str | None
    amount: int | None
    currency: str | None
    merchant_name: str | None
    merchant_url: str | None
    line_items: Sequence[LineItemParams] | None
    totals: Sequence[TotalParams] | None
    request_approval: bool | None
    test: bool | None
    approval_details: ApprovalDetailParams | None
    metadata: Mapping[str, str] | None


class UpdateSpendRequestParams(TypedDict, total=False):
    payment_details: str | None
    amount: int | None
    merchant_url: str | None
    profile_id: str | None
    merchant_id: str | None
    currency: str | None
    line_items: Sequence[LineItemParams] | None
    totals: Sequence[TotalParams] | None


class ListSpendRequestsParams(TypedDict, total=False):
    include_history: bool


class RetrieveSpendRequestParams(TypedDict, total=False):
    include: Sequence[str] | None


class ListTransactionsParams(TypedDict, total=False):
    limit: int | None
    starting_after: str | None
    ending_before: str | None
    start_date: str | None
    end_date: str | None
    category: str | None
    origin: TransactionOrigin | None
    sources: Sequence[str] | None


class ListSourcesParams(TypedDict, total=False):
    limit: int | None
    starting_after: str | None
    ending_before: str | None


class ListBalancesParams(ListSourcesParams, total=False):
    sources: Sequence[str] | None


class CreateReportParams(TypedDict, total=False):
    domain: Required[str]
    outcome: Required[ReportOutcome]
    spend_request_id: Required[str]
    tags: Sequence[ReportTag] | None
    step: str | None
    freeform_context: str | None
