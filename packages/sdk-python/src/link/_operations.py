"""Wire contracts shared by both client styles."""

import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any
from urllib.parse import quote

from ._transport import Request
from .errors import LinkSDKError
from .models import (
    BalancesPage,
    LinkModel,
    PaymentMethod,
    ReportRecord,
    RequestApprovalResponse,
    ShippingAddressRecord,
    SourcesPage,
    SpendRequest,
    TransactionsPage,
    UserInfo,
    WebBotAuthBlock,
)


class _SpendRequests(LinkModel):
    data: list[SpendRequest]


class _PaymentMethods(LinkModel):
    payment_details: list[PaymentMethod]


class _ShippingAddresses(LinkModel):
    shipping_addresses: list[ShippingAddressRecord]


class _Approval(LinkModel):
    id: str
    approval_link: str


class _WebBotAuth(LinkModel):
    web_bot_auth: WebBotAuthBlock


def _approval(data: Any) -> RequestApprovalResponse:
    wire = _Approval.model_validate(data)
    if not wire.id or not wire.approval_link:
        raise ValueError("response is missing id or approval_link")
    return RequestApprovalResponse(id=wire.id, approval_url=wire.approval_link)


def _userinfo(data: Any) -> UserInfo:
    if isinstance(data, dict) and "agent_wallet_step_up" in data:
        data = dict(data)
        data["agent_wallet_verification_requirement"] = data.pop("agent_wallet_step_up")
    return UserInfo.model_validate(data)


def _transactions(data: Any) -> TransactionsPage:
    return TransactionsPage.model_validate(
        {"data": data} if isinstance(data, list) else data
    )


def signing_expiry(value: str) -> datetime:
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?"
        r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)",
        value,
    ):
        raise ValueError("expires_at must be an RFC3339 timestamp")
    return datetime.fromisoformat(value)


def _web_bot_auth(data: Any) -> WebBotAuthBlock:
    block = _WebBotAuth.model_validate(data).web_bot_auth
    if not all(
        (
            block.signature,
            block.signature_input,
            block.signature_agent,
            block.authority,
            block.expires_at,
        )
    ):
        raise ValueError("response is missing required signing fields")
    signing_expiry(block.expires_at)
    return block


def _spend_path(id: str) -> str:
    # HTTP clients normalize literal dot segments, so encode those IDs as well.
    segment = quote(id, safe="")
    if id in (".", ".."):
        segment = segment.replace(".", "%2E")
    return "/spend_requests/" + segment


def spend_list(include_history: bool) -> Request[list[SpendRequest]]:
    return Request(
        "list spend requests",
        "GET",
        "/spend_requests",
        lambda data: _SpendRequests.model_validate(data).data,
        spend=True,
        query=(("include_history", "true"),) if include_history else (),
    )


def spend_create(params: Mapping[str, Any]) -> Request[SpendRequest]:
    return Request(
        "create spend request",
        "POST",
        "/spend_requests",
        SpendRequest.model_validate,
        spend=True,
        body=params,
    )


def spend_update(id: str, params: Mapping[str, Any]) -> Request[SpendRequest]:
    return Request(
        "update spend request",
        "POST",
        _spend_path(id),
        SpendRequest.model_validate,
        spend=True,
        body=params,
    )


def spend_retrieve(
    id: str, include: Sequence[str] | None
) -> Request[SpendRequest | None]:
    _validate_string_sequence("include", include)
    return Request[SpendRequest | None](
        "retrieve spend request",
        "GET",
        _spend_path(id),
        SpendRequest.model_validate,
        spend=True,
        query=(("include", ",".join(include)),) if include else (),
        on_not_found=lambda: None,
    )


def spend_approve(id: str) -> Request[RequestApprovalResponse]:
    return Request(
        "request approval",
        "POST",
        _spend_path(id) + "/request_approval",
        _approval,
        spend=True,
    )


def spend_cancel(id: str) -> Request[SpendRequest]:
    return Request(
        "cancel spend request",
        "POST",
        _spend_path(id) + "/cancel",
        SpendRequest.model_validate,
        spend=True,
    )


def payment_methods() -> Request[list[PaymentMethod]]:
    return Request(
        "list payment methods",
        "GET",
        "/payment-details",
        lambda data: _PaymentMethods.model_validate(data).payment_details,
    )


def _payment_method_path(id: str) -> str:
    # HTTP clients normalize literal dot segments, so encode those IDs as well.
    segment = quote(id, safe="")
    if id in (".", ".."):
        segment = segment.replace(".", "%2E")
    return "/payment-details/" + segment


def payment_method_update(id: str, nickname: str) -> Request[PaymentMethod]:
    return Request(
        "update payment method",
        "POST",
        _payment_method_path(id),
        PaymentMethod.model_validate,
        body={"nickname": nickname},
    )


def shipping_addresses() -> Request[list[ShippingAddressRecord]]:
    return Request(
        "list shipping addresses",
        "GET",
        "/shipping_addresses",
        lambda data: _ShippingAddresses.model_validate(data).shipping_addresses,
    )


def user_info() -> Request[UserInfo]:
    return Request("retrieve user info", "GET", "/userinfo", _userinfo)


def _validate_string_sequence(name: str, value: Sequence[str] | None) -> None:
    if isinstance(value, (str, bytes, bytearray)):
        raise LinkSDKError(f"`{name}` must be a sequence of strings, such as a list.")


def _query(params: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    query: list[tuple[str, str]] = []
    aliases = {"start_date": "date_start", "end_date": "date_end"}
    for key, value in params.items():
        if value is None:
            continue
        if key == "sources":
            _validate_string_sequence(key, value)
            query.extend(("sources[]", source) for source in value)
        else:
            query.append((aliases.get(key, key), str(value)))
    return tuple(query)


def transactions(params: Mapping[str, Any]) -> Request[TransactionsPage]:
    return Request(
        "list transactions", "GET", "/transactions", _transactions, query=_query(params)
    )


def sources(params: Mapping[str, Any]) -> Request[SourcesPage]:
    return Request(
        "list sources",
        "GET",
        "/sources",
        SourcesPage.model_validate,
        query=_query(params),
    )


def balances(params: Mapping[str, Any]) -> Request[BalancesPage]:
    return Request(
        "list balances",
        "GET",
        "/balances",
        BalancesPage.model_validate,
        query=_query(params),
    )


def report_create(params: Mapping[str, Any]) -> Request[ReportRecord]:
    return Request(
        "create report",
        "POST",
        "/agent_observations",
        ReportRecord.model_validate,
        body=params,
    )


def web_bot_sign(url: str) -> Request[WebBotAuthBlock]:
    return Request(
        "get web bot auth headers",
        "POST",
        "/web_bot_auth/sign",
        _web_bot_auth,
        body={"url": url},
    )
