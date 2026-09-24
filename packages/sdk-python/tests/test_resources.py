import json
from datetime import UTC, datetime, timedelta
from types import MappingProxyType
from typing import Any

import pytest
from conftest import API
from fixtures import ADDRESS, BALANCE, SPEND, TRANSACTION

from link import (
    BalancesPage,
    LinkAPIError,
    LinkResponseError,
    LinkSDKError,
    PaymentMethod,
    ReportRecord,
    ShippingAddressRecord,
    SourcesPage,
    SpendRequest,
    TransactionsPage,
)

CONTEXT = (
    "The user asked the agent to purchase the selected item from Acme for $25.99, "
    "including the displayed shipping cost."
)


@pytest.mark.parametrize(
    ("resource", "method", "path", "body", "model", "is_list"),
    [
        (
            "payment_methods",
            "list",
            "/payment-details",
            {
                "payment_details": [
                    {
                        "id": "pm_1",
                        "type": "card",
                        "is_default": True,
                        "name": "Visa",
                        "capabilities": {
                            "card": {"eligible": True, "ineligibility_reasons": []}
                        },
                    }
                ]
            },
            PaymentMethod,
            True,
        ),
        (
            "shipping_addresses",
            "list",
            "/shipping_addresses",
            {
                "shipping_addresses": [
                    {
                        "id": "addr_1",
                        "is_default": False,
                        "nickname": None,
                        "address": ADDRESS,
                    }
                ]
            },
            ShippingAddressRecord,
            True,
        ),
        (
            "spend_requests",
            "list",
            "/spend_requests",
            {"data": [SPEND]},
            SpendRequest,
            True,
        ),
        (
            "transactions",
            "list",
            "/transactions",
            {"data": [TRANSACTION], "has_more": True},
            TransactionsPage,
            False,
        ),
        (
            "sources",
            "list",
            "/sources",
            {"data": [{"id": "source_1"}]},
            SourcesPage,
            False,
        ),
        (
            "balances",
            "list",
            "/balances",
            {"data": [BALANCE]},
            BalancesPage,
            False,
        ),
    ],
)
async def test_list_resources(
    api: API,
    resource: str,
    method: str,
    path: str,
    body: Any,
    model: type,
    is_list: bool,
) -> None:
    api.respond(body)
    result = await api.call(resource, method)
    assert isinstance(result[0] if is_list else result, model)
    request = api.requests[0]
    assert request.method == "GET"
    assert str(request.url) == "https://api.link.com" + path
    assert request.headers["Authorization"] == "Bearer test-token"
    assert request.content == b""


@pytest.mark.parametrize("nickname", ["Work card", ""])
async def test_update_payment_method(api: API, nickname: str) -> None:
    api.respond(
        {
            "id": "pd_1",
            "type": "CARD",
            "is_default": True,
            "name": "Visa",
            "nickname": nickname or None,
        }
    )

    result = await api.call("payment_methods", "update", "pd_1", nickname=nickname)

    assert isinstance(result, PaymentMethod)
    assert result.nickname == (nickname or None)
    request = api.requests[0]
    assert request.method == "POST"
    assert request.url.path == "/payment-details/pd_1"
    assert request.headers["Content-Type"] == "application/json"
    assert json.loads(request.content) == {"nickname": nickname}


@pytest.mark.parametrize("id", ["pd/a?b#c%", "..", ".", "a b", "é"])
async def test_update_payment_method_path_encoding(api: API, id: str) -> None:
    from urllib.parse import unquote

    api.respond(
        {
            "id": id,
            "type": "CARD",
            "is_default": False,
            "name": "Visa",
            "nickname": "Work",
        }
    )
    await api.call("payment_methods", "update", id, nickname="Work")
    raw_path = api.requests[0].url.raw_path.decode()
    segment = raw_path.removeprefix("/payment-details/")
    assert "/" not in segment
    assert unquote(segment) == id


@pytest.mark.parametrize("status", [400, 403, 404])
async def test_update_payment_method_api_errors(api: API, status: int) -> None:
    api.respond({"error": {"message": "nickname unavailable"}}, status)
    with pytest.raises(LinkAPIError) as caught:
        await api.call("payment_methods", "update", "pd_1", nickname="Work")
    assert caught.value.status == status
    assert "nickname unavailable" in str(caught.value)


async def test_update_payment_method_malformed_response(api: API) -> None:
    api.respond({"id": 123})
    with pytest.raises(LinkResponseError):
        await api.call("payment_methods", "update", "pd_1", nickname="Work")


@pytest.mark.parametrize("address", [{}, {"country_code": "US", "line_1": "123 Main"}])
async def test_sparse_shipping_address_preserves_field_presence(
    api: API, address: dict[str, str]
) -> None:
    record = {"id": "addr_1", "is_default": False, "address": address}
    api.respond({"shipping_addresses": [record]})
    result = (await api.call("shipping_addresses", "list"))[0]
    assert result.nickname is None
    assert result.address.name is None
    assert result.model_dump(exclude_unset=True) == record


@pytest.mark.parametrize("value", ["card", b"card"])
@pytest.mark.parametrize("resource", ["spend_requests", "transactions", "balances"])
async def test_string_instead_of_sequence_is_rejected(
    api: API, resource: str, value: Any
) -> None:
    with pytest.raises(LinkSDKError, match="sequence of strings"):
        if resource == "spend_requests":
            await api.call(resource, "retrieve", "sr_1", include=value)
        else:
            await api.call(resource, "list", sources=value)
    assert not api.requests


async def test_create_all_fields_and_nested_omission(api: API) -> None:
    params = {
        "context": CONTEXT,
        "idempotency_key": "idem-1",
        "payment_details": "pm_1",
        "credential_type": "card",
        "network_id": "network",
        "execution_method": "link_pay_token",
        "merchant_account_id": "acct_1",
        "amount": 0,
        "currency": "usd",
        "merchant_name": "Acme",
        "merchant_url": "https://acme.example",
        "line_items": [
            {
                "name": "Item",
                "url": "https://acme.example/item",
                "image_url": "image",
                "description": "description",
                "sku": "sku",
                "totals": [],
                "quantity": 0,
                "unit_amount": 0,
                "product_url": None,
            }
        ],
        "totals": [{"type": "total", "display_text": "$0", "amount": 0}],
        "request_approval": False,
        "test": False,
        "metadata": {},
        "approval_details": {
            "approved_at": 123,
            "approval_method": "click",
            "app_name": "app",
            "external_user_id": "user",
            "ip_address": "127.0.0.1",
            "user_agent": "agent",
            "device_type": "web",
            "agent_log_id": "log",
            "external_user_name": "name",
            "external_session_id": "session",
            "authentication_method": "passkey",
        },
    }
    api.respond(SPEND)
    result = await api.call("spend_requests", "create", **params)
    assert result.id == "sr_123"
    expected = dict(params)
    expected["line_items"] = [
        {k: v for k, v in params["line_items"][0].items() if v is not None}
    ]
    assert json.loads(api.requests[0].content) == expected
    assert api.requests[0].method == "POST"
    assert api.requests[0].headers["Content-Type"] == "application/json"
    assert "idempotency-key" not in api.requests[0].headers


async def test_minimal_create_and_explicit_empty_collections(api: API) -> None:
    for params, expected in [
        ({"context": CONTEXT}, {"context": CONTEXT}),
        (
            {
                "context": CONTEXT,
                "amount": None,
                "idempotency_key": None,
                "line_items": [],
                "totals": [],
                "metadata": {},
            },
            {"context": CONTEXT, "line_items": [], "totals": [], "metadata": {}},
        ),
    ]:
        api.respond(SPEND)
        await api.call("spend_requests", "create", **params)
        assert json.loads(api.requests[-1].content) == expected


async def test_update_all_fields(api: API) -> None:
    params = {
        "payment_details": "pm_1",
        "amount": 0,
        "merchant_url": "",
        "profile_id": "profile",
        "merchant_id": "merchant",
        "currency": "usd",
        "line_items": [],
        "totals": [],
    }
    api.respond(SPEND)
    await api.call("spend_requests", "update", "sr_123", **params)
    assert api.requests[0].method == "POST"
    assert api.requests[0].url.path == "/spend_requests/sr_123"
    assert json.loads(api.requests[0].content) == params
    api.respond(SPEND)
    await api.call("spend_requests", "update", "sr_123")
    assert api.requests[1].content == b"{}"
    with pytest.raises(TypeError):
        await api.call(
            "spend_requests", "update", "sr_123", execution_method="link_pay_token"
        )


@pytest.mark.parametrize("id", ["sr/a?b#c%", "..", ".", "a b", "é"])
async def test_retrieve_path_encoding_and_include(api: API, id: str) -> None:
    from urllib.parse import unquote

    api.respond(SPEND)
    await api.call(
        "spend_requests", "retrieve", id, include=["card", "shared_payment_token"]
    )
    request = api.requests[0]
    raw_path = request.url.raw_path.split(b"?")[0].decode()
    assert raw_path.startswith("/spend_requests/")
    segment = raw_path.removeprefix("/spend_requests/")
    assert "/" not in segment
    assert unquote(segment) == id
    assert request.url.params["include"] == "card,shared_payment_token"


async def test_missing_spend_request_only_suppresses_retrieve_404(api: API) -> None:
    api.respond({"error": "missing"}, 404)
    assert await api.call("spend_requests", "retrieve", "missing") is None
    api.respond({"error": "missing"}, 404)
    with pytest.raises(LinkAPIError):
        await api.call("spend_requests", "cancel", "missing")


async def test_approval_and_cancel(api: API) -> None:
    api.respond({"id": "sr_123", "approval_link": "https://link.com/approve"})
    approval = await api.call("spend_requests", "request_approval", "sr_123")
    assert approval.approval_url == "https://link.com/approve"
    assert api.requests[0].url.path == "/spend_requests/sr_123/request_approval"
    assert api.requests[0].method == "POST"
    assert api.requests[0].content == b""
    api.respond({**SPEND, "status": "canceled"})
    result = await api.call("spend_requests", "cancel", "sr_123")
    assert result.status == "canceled"
    assert api.requests[1].url.path == "/spend_requests/sr_123/cancel"
    assert api.requests[1].content == b""
    for data in ({}, {"id": "sr_123"}, {"approval_link": "https://link.com/approve"}):
        api.respond(data)
        with pytest.raises(LinkResponseError):
            await api.call("spend_requests", "request_approval", "sr_123")


async def test_queries(api: API) -> None:
    api.respond({"data": []})
    await api.call("spend_requests", "list", include_history=True)
    assert dict(api.requests[-1].url.params) == {"include_history": "true"}
    common = {"limit": 0, "starting_after": "a/b ?", "ending_before": ""}
    for resource in ("sources", "transactions", "balances"):
        params: dict[str, Any] = dict(common)
        if resource != "sources":
            params["sources"] = ["one", "two/a"]
        if resource == "transactions":
            params.update(
                start_date="2026-01-01",
                end_date="2026-02-01",
                category="shopping",
                origin="external_connection",
            )
        api.respond({"data": []})
        await api.call(resource, "list", **params)
        query = api.requests[-1].url.params
        for key, value in common.items():
            assert query[key] == str(value)
        if resource != "sources":
            assert query.get_list("sources[]") == ["one", "two/a"]
        if resource == "transactions":
            assert query["date_start"] == "2026-01-01"
            assert query["date_end"] == "2026-02-01"
            assert query["category"] == "shopping"
            assert query["origin"] == "external_connection"
            assert "start_date" not in query
    api.respond({"data": []})
    await api.call("balances", "list", sources=[], limit=None)
    assert not api.requests[-1].url.query


async def test_user_info_enrichment(api: API) -> None:
    for enrich in (False, True):
        data: dict[str, Any] = {
            "email": "user@example.com",
            "name": "User",
            "first_name": "U",
            "last_name": "Ser",
            "phone": None,
        }
        if enrich:
            data.update(
                agent_wallet_spend_limits={
                    "per_transaction": {"limit": 500},
                    "daily": {"limit": None, "used": 100, "remaining": None},
                    "thirty_day": {"limit": 1000, "used": 200, "remaining": 800},
                },
                agent_wallet_step_up={"status": "ssn_verification", "action_url": None},
            )
        api.respond(data)
        user = await api.call("user_info", "retrieve")
        assert user.email == "user@example.com"
        assert api.requests[-1].url.path == "/userinfo"
        if enrich:
            assert (
                user.agent_wallet_verification_requirement.status == "ssn_verification"
            )
            assert user.agent_wallet_spend_limits.daily.limit is None
            assert user.agent_wallet_spend_limits.daily.used == 100
            assert user.agent_wallet_spend_limits.thirty_day.remaining == 800
        else:
            assert user.agent_wallet_spend_limits is None
            assert user.agent_wallet_verification_requirement is None
            assert "agent_wallet_spend_limits" not in user.model_fields_set
            assert "agent_wallet_verification_requirement" not in user.model_fields_set


async def test_legacy_transactions_and_tokens(api: API) -> None:
    api.respond([{**TRANSACTION, "origin": "future"}])
    page = await api.call("transactions", "list")
    assert isinstance(page, TransactionsPage)
    assert page.has_more is None
    assert page.data[0].origin == "future"
    for token in ("spt_secret", {"id": "spt_secret", "valid_until": "now"}):
        api.respond({**SPEND, "shared_payment_token": token})
        result = await api.call("spend_requests", "retrieve", "sr_123")
        assert result.shared_payment_token.id == "spt_secret"
    api.respond({**SPEND, "shared_payment_token": {}})
    with pytest.raises(LinkResponseError):
        await api.call("spend_requests", "retrieve", "sr_123")


async def test_report_all_fields(api: API) -> None:
    params = {
        "domain": "merchant.example",
        "outcome": "success",
        "spend_request_id": "sr_123",
        "tags": [],
        "step": "checkout",
        "freeform_context": "all done",
    }
    api.respond(
        {
            "object": "agent_observation",
            "created_at": "now",
            "status": "created",
            "domain": "merchant.example",
            "outcome": "success",
            "spend_request_id": "sr_123",
        }
    )
    report = await api.call("reports", "create", **params)
    assert isinstance(report, ReportRecord)
    assert api.requests[0].url.path == "/agent_observations"
    assert json.loads(api.requests[0].content) == params


def signing_block(expiry: str = "2099-01-01T00:00:00Z") -> dict[str, str]:
    return {
        "signature": "sig",
        "signature_input": "input",
        "signature_agent": "agent",
        "authority": "merchant.example",
        "expires_at": expiry,
    }


async def test_web_bot_cache_expiry_and_independent_copies(
    api: API, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    monkeypatch.setattr("link._web_bot_auth._now", lambda: now)
    expiry = (now + timedelta(seconds=60)).isoformat()
    api.respond({"web_bot_auth": signing_block(expiry)})
    first = await api.call("web_bot_auth", "sign_url", "https://merchant.example/one")
    first.signature = "modified"
    second = await api.call(
        "web_bot_auth", "sign_url", "https://merchant.example:8443/two"
    )
    assert second.signature == "sig"
    second.signature = "also modified"
    assert len(api.requests) == 1
    assert api.requests[0].url.path == "/web_bot_auth/sign"
    assert json.loads(api.requests[0].content) == {
        "url": "https://merchant.example/one"
    }
    now += timedelta(seconds=30)
    api.respond({"web_bot_auth": signing_block()})
    await api.call("web_bot_auth", "sign_url", "https://merchant.example/three")
    assert len(api.requests) == 2
    api.respond({"web_bot_auth": signing_block()})
    await api.call("web_bot_auth", "sign_url", "https://another.example/")
    assert len(api.requests) == 3


async def test_web_bot_ancient_expiry_is_not_cached(api: API) -> None:
    api.respond({"web_bot_auth": signing_block("0001-01-01T00:00:00Z")})
    await api.call("web_bot_auth", "sign_url", "https://merchant.example")
    api.respond({"web_bot_auth": signing_block()})
    await api.call("web_bot_auth", "sign_url", "https://merchant.example")
    assert len(api.requests) == 2


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"web_bot_auth": {}},
        {"web_bot_auth": signing_block("not-a-date")},
        {"web_bot_auth": signing_block("2026-01-01T00:00:00")},
        {"web_bot_auth": signing_block("2026-01-01T00:00:00+00:99")},
        {"web_bot_auth": signing_block("2026-01-01T00:00:00-24:00")},
    ],
)
async def test_web_bot_rejects_bad_responses_without_caching(
    api: API, data: Any
) -> None:
    api.respond(data)
    with pytest.raises(LinkResponseError):
        await api.call("web_bot_auth", "sign_url", "https://merchant.example")
    api.respond({"web_bot_auth": signing_block()})
    await api.call("web_bot_auth", "sign_url", "https://merchant.example")
    assert len(api.requests) == 2


@pytest.mark.parametrize("url", ["relative", "/path", "https://", "http://[broken"])
async def test_web_bot_rejects_invalid_urls(api: API, url: str) -> None:
    with pytest.raises(LinkSDKError):
        await api.call("web_bot_auth", "sign_url", url)
    assert not api.requests


@pytest.mark.parametrize(
    "resource,key",
    [
        ("spend_requests", "data"),
        ("payment_methods", "payment_details"),
        ("shipping_addresses", "shipping_addresses"),
        ("transactions", "data"),
        ("sources", "data"),
        ("balances", "data"),
    ],
)
@pytest.mark.parametrize("explicit_null", [False, True])
async def test_missing_list_is_not_silently_treated_as_empty(
    api: API,
    resource: str,
    key: str,
    explicit_null: bool,
) -> None:
    api.respond({key: None} if explicit_null else {})
    with pytest.raises(LinkResponseError):
        await api.call(resource, "list")
    api.respond({key: []})
    result = await api.call(resource, "list")
    assert (result if isinstance(result, list) else result.data) == []


async def test_read_only_sequences_and_mappings(api: API) -> None:
    api.respond(SPEND)
    await api.call(
        "spend_requests",
        "create",
        context=CONTEXT,
        line_items=({"name": "Item", "totals": ()},),
        metadata=MappingProxyType({"order": "123"}),
    )
    assert json.loads(api.requests[0].content) == {
        "context": CONTEXT,
        "line_items": [{"name": "Item", "totals": []}],
        "metadata": {"order": "123"},
    }
    api.respond(SPEND)
    await api.call(
        "spend_requests", "retrieve", "sr_123", include=("card", "shared_payment_token")
    )
    assert api.requests[-1].url.params["include"] == "card,shared_payment_token"
    api.respond({"data": []})
    await api.call("balances", "list", sources=("source_1", "source_2"))
    assert api.requests[-1].url.params.get_list("sources[]") == ["source_1", "source_2"]
