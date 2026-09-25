import asyncio
import inspect
import json
import logging
import traceback
import warnings
from typing import Any

import httpx
import pytest
from conftest import API
from fixtures import CARD, SPEND

from link import (
    AsyncClient,
    Client,
    GetAccessTokenOptions,
    LinkAPIError,
    LinkConfigurationError,
    LinkError,
    LinkResponseError,
    LinkTransportError,
    get_duplicate_spend_request,
)


@pytest.mark.parametrize(
    "options",
    [
        {},
        {"access_token": ""},
        {"access_token": "  "},
        {"access_token": 123},
        {"access_token": "token", "get_access_token": lambda options: "token"},
        {"access_token": "token", "api_base_url": "relative"},
        {"access_token": "token", "api_base_url": "ftp://api.link.com"},
        {"access_token": "token", "api_base_url": "https://api.link.com?q=1"},
        {"access_token": "token", "api_base_url": "https://api.link.com?"},
        {"access_token": "token", "api_base_url": "https://api.link.com#"},
        {"access_token": "token", "spend_request_base_url": "https://api.link.com#f"},
        {"access_token": "token", "api_base_url": "http://[broken"},
        {"get_access_token": "not callable"},
        {"access_token": "token", "timeout": -1},
        {"access_token": "token", "timeout": float("inf")},
        {"access_token": "token", "timeout": float("nan")},
        {"access_token": "token", "timeout": True},
        {"access_token": "token", "timeout": "30"},
        {"access_token": "token", "timeout": httpx.Timeout(30, read=-1)},
    ],
)
def test_configuration(mode: str, options: dict[str, Any]) -> None:
    constructor = AsyncClient if mode == "async" else Client
    with pytest.raises(LinkConfigurationError) as error:
        constructor(**options)
    assert error.value.code == "configuration_error"


@pytest.mark.parametrize("second_status", [200, 401, 500])
async def test_refresh_once_and_replay_identical_body(
    mode: str, second_status: int
) -> None:
    calls = []

    def provider(options: GetAccessTokenOptions) -> str:
        calls.append(options.force_refresh)
        return "new" if options.force_refresh else "old"

    api = API(mode, get_access_token=provider)
    try:
        api.respond({"error": "expired"}, 401)
        api.respond(SPEND, second_status)
        if second_status == 200:
            assert (
                await api.call(
                    "spend_requests", "create", context="test", idempotency_key="idem"
                )
            ).id == "sr_123"
        else:
            with pytest.raises(LinkAPIError) as error:
                await api.call(
                    "spend_requests", "create", context="test", idempotency_key="idem"
                )
            assert error.value.status == second_status
        assert calls == [False, True]
        assert [r.headers["Authorization"] for r in api.requests] == [
            "Bearer old",
            "Bearer new",
        ]
        assert api.requests[0].content == api.requests[1].content
        assert api.requests[0].url == api.requests[1].url
        assert api.requests[0].method == api.requests[1].method == "POST"
    finally:
        await api.close()


async def test_async_provider() -> None:
    calls = []

    async def provider(options: GetAccessTokenOptions) -> str:
        await asyncio.sleep(0)
        calls.append(options.force_refresh)
        return "token"

    api = API("async", get_access_token=provider)
    try:
        api.respond({}, 401)
        api.respond({"payment_details": []})
        await api.call("payment_methods", "list")
        api.respond({"payment_details": []})
        await api.call("payment_methods", "list")
        assert calls == [False, True, False]
    finally:
        await api.close()


@pytest.mark.parametrize("on_refresh", [False, True])
async def test_provider_failure_is_unchanged(mode: str, on_refresh: bool) -> None:
    cause = RuntimeError("provider failed")

    def provider(options: GetAccessTokenOptions) -> str:
        if options.force_refresh == on_refresh:
            raise cause
        return "old"

    api = API(mode, get_access_token=provider)
    try:
        api.respond({}, 401)
        with pytest.raises(RuntimeError) as error:
            await api.call("payment_methods", "list")
        assert error.value is cause
        assert len(api.requests) == int(on_refresh)
    finally:
        await api.close()


@pytest.mark.parametrize("status", [401, 403, 409, 429, 500])
async def test_fixed_token_does_not_retry(api: API, status: int) -> None:
    api.respond({"error": {"message": "failed"}}, status)
    with pytest.raises(LinkAPIError) as error:
        await api.call("payment_methods", "list")
    assert error.value.code == "api_error"
    assert error.value.status == status
    assert error.value.details == {"error": {"message": "failed"}}
    assert len(api.requests) == 1


@pytest.mark.parametrize(
    "body",
    [
        b"null",
        b"",
        b"not JSON",
        b"[]",
        b'{"payment_details":{}}',
        b'{"payment_details":[],"future":NaN}',
        b'{"payment_details":[{"id":[]}]}',
        b'{"payment_details":[{"is_default":1}]}',
        b'{"payment_details":[{"card_details":{"exp_month":"1"}}]}',
    ],
)
async def test_bad_success_response_is_typed(api: API, body: bytes) -> None:
    api.responses.append(httpx.Response(200, content=body))
    with pytest.raises(LinkResponseError) as error:
        await api.call("payment_methods", "list")
    assert isinstance(error.value, LinkError)
    assert error.value.status == 200
    assert error.value.code == "invalid_response"
    assert error.value.__cause__ is not None


@pytest.mark.parametrize(
    "cause",
    [
        httpx.ConnectError("unreachable"),
        httpx.ReadError("read failed"),
        httpx.ReadTimeout("timed out"),
    ],
)
async def test_transport_error_preserves_cause(api: API, cause: Exception) -> None:
    api.responses.append(cause)
    with pytest.raises(LinkTransportError) as error:
        await api.call("payment_methods", "list")
    assert error.value.__cause__ is cause
    assert error.value.code == "transport_error"


async def test_configured_hosts_headers_and_logging(
    mode: str, caplog: pytest.LogCaptureFixture
) -> None:
    headers = {
        "Content-Type": "text/plain",
        "Authorization": "wrong",
        "X-Agent": "original",
    }
    api = API(
        mode,
        api_base_url="https://general.example/v1/",
        spend_request_base_url="https://spend.example/v2/",
        default_headers=headers,
        verbose=True,
        logger=logging.getLogger("link-test"),
    )
    headers["X-Agent"] = "changed"
    api.http_client.auth = httpx.BasicAuth("bad", "auth")
    try:
        with caplog.at_level(logging.DEBUG, logger="link-test"):
            api.respond({**SPEND, "card": {**CARD, "number": "secret-card"}})
            await api.call("spend_requests", "create", context="secret-context")
            api.respond({"payment_details": []})
            await api.call("payment_methods", "list")
        assert str(api.requests[0].url) == "https://spend.example/v2/spend_requests"
        assert str(api.requests[1].url) == "https://general.example/v1/payment-details"
        assert api.requests[0].headers["Content-Type"] == "application/json"
        assert api.requests[0].headers["Authorization"] == "Bearer test-token"
        assert api.requests[0].headers["X-Agent"] == "original"
        assert "POST https://spend.example/v2/spend_requests" in caplog.text
        assert "< 200 OK" in caplog.text
        for secret in ("secret-card", "secret-context", "test-token", "Authorization"):
            assert secret not in caplog.text
    finally:
        await api.close()


async def test_injected_query_defaults_preserve_filters_and_auth_retry(
    mode: str,
) -> None:
    api = API(mode, get_access_token=lambda options: "token")
    api.http_client.params = {"tenant": "demo", "limit": "99", "sources[]": "default"}
    try:
        api.respond({}, 401)
        api.respond({"data": []})
        await api.call("transactions", "list", limit=4, sources=("a", "b"))
        for request in api.requests:
            assert request.url.params["tenant"] == "demo"
            assert request.url.params["limit"] == "4"
            assert request.url.params.get_list("sources[]") == ["a", "b"]
        assert len(api.requests) == 2
        assert api.requests[0].url == api.requests[1].url

        api.respond(SPEND)
        await api.call("spend_requests", "retrieve", "sr_1", include=("card",))
        assert api.requests[-1].url.params["include"] == "card"
    finally:
        await api.close()


@pytest.mark.parametrize("suffix", ["\n", "\r", "\t", "\x00", "\x7f", "é", " "])
async def test_invalid_token_is_rejected_without_exposing_it(
    mode: str, suffix: str
) -> None:
    secret = "synthetic-secret" + suffix
    constructor = AsyncClient if mode == "async" else Client
    with pytest.raises(LinkConfigurationError) as static:
        constructor(access_token=secret)
    assert "synthetic-secret" not in "".join(traceback.format_exception(static.value))

    api = API(mode, get_access_token=lambda options: secret)
    try:
        with pytest.raises(LinkConfigurationError) as dynamic:
            await api.call("payment_methods", "list")
        assert "synthetic-secret" not in "".join(
            traceback.format_exception(dynamic.value)
        )
        assert not api.requests
    finally:
        await api.close()


async def test_default_host_fallback_and_response_closed(mode: str) -> None:
    api = API(mode, api_base_url="https://general.example/prefix/")
    response = httpx.Response(200, json=SPEND)
    api.responses.append(response)
    try:
        await api.call("spend_requests", "retrieve", "sr_1")
        assert (
            str(api.requests[0].url)
            == "https://general.example/prefix/spend_requests/sr_1"
        )
        assert response.is_closed
    finally:
        await api.close()


async def test_client_lifecycle(mode: str) -> None:
    if mode == "async":
        async with AsyncClient(access_token="token") as client:
            owned = client._http_client
            assert owned.timeout == httpx.Timeout(30)
        assert owned.is_closed
        await client.aclose()
        async with httpx.AsyncClient(timeout=7) as borrowed:
            async with AsyncClient(access_token="token", http_client=borrowed):
                pass
            assert not borrowed.is_closed
            assert borrowed.timeout == httpx.Timeout(7)
    else:
        with Client(access_token="token") as client:
            owned = client._http_client
            assert owned.timeout == httpx.Timeout(30)
        assert owned.is_closed
        client.close()
        with httpx.Client(timeout=7) as borrowed:
            with Client(access_token="token", http_client=borrowed):
                pass
            assert not borrowed.is_closed
            assert borrowed.timeout == httpx.Timeout(7)


@pytest.mark.parametrize("timeout", [0, 7.5, None, httpx.Timeout(30, connect=2)])
async def test_timeout_override_is_sent_without_mutating_http_client(
    mode: str,
    timeout: float | httpx.Timeout | None,
) -> None:
    api = API(mode, timeout=timeout)
    original = httpx.Timeout(api.http_client.timeout)
    try:
        api.respond({"payment_details": []})
        await api.call("payment_methods", "list")
        assert api.requests[0].extensions["timeout"] == httpx.Timeout(timeout).as_dict()
        assert api.http_client.timeout == original
    finally:
        await api.close()


async def test_omitted_timeout_respects_custom_client(mode: str) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"payment_details": []})

    transport = httpx.MockTransport(handler)
    timeout = httpx.Timeout(7, connect=2)
    if mode == "async":
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as http:
            async with AsyncClient(access_token="token", http_client=http) as client:
                await client.payment_methods.list()
    else:
        with httpx.Client(timeout=timeout, transport=transport) as http:
            with Client(access_token="token", http_client=http) as client:
                client.payment_methods.list()
    assert requests[0].extensions["timeout"] == timeout.as_dict()


@pytest.mark.parametrize("invalid", [None, "", "  ", 123, b"token"])
@pytest.mark.parametrize("on_refresh", [False, True])
async def test_invalid_provider_return_is_configuration_error(
    mode: str,
    invalid: Any,
    on_refresh: bool,
) -> None:
    def provider(options: GetAccessTokenOptions) -> str:
        return invalid if options.force_refresh == on_refresh else "old"

    api = API(mode, get_access_token=provider)
    try:
        api.respond({}, 401)
        with pytest.raises(LinkConfigurationError, match="non-empty string"):
            await api.call("payment_methods", "list")
        assert len(api.requests) == int(on_refresh)
    finally:
        await api.close()


async def test_async_provider_invalid_return() -> None:
    async def provider(options: GetAccessTokenOptions) -> Any:
        return None

    api = API("async", get_access_token=provider)
    try:
        with pytest.raises(LinkConfigurationError, match="non-empty string"):
            await api.call("payment_methods", "list")
        assert not api.requests
    finally:
        await api.close()


async def test_sync_client_rejects_async_provider_without_unawaited_warning() -> None:
    async def provider(options: GetAccessTokenOptions) -> str:
        return "token"

    with warnings.catch_warnings(record=True) as captured:
        api = API("sync", get_access_token=provider)
        try:
            with pytest.raises(LinkConfigurationError, match="Use AsyncClient"):
                await api.call("payment_methods", "list")
            assert not api.requests
        finally:
            await api.close()
    assert not captured


@pytest.mark.parametrize("field", ["card", "shared_payment_token", "link_pay_token"])
@pytest.mark.parametrize("missing_required", [False, True])
async def test_validation_tracebacks_hide_credentials(
    api: API,
    caplog: pytest.LogCaptureFixture,
    field: str,
    missing_required: bool,
) -> None:
    marker = "synthetic-secret-that-must-not-be-logged"
    value: Any
    if field == "card":
        value = {"number": marker} if missing_required else {**CARD, "number": [marker]}
    elif field == "shared_payment_token":
        value = {"secret": marker} if missing_required else {"id": [marker]}
    else:
        value = [marker]
    api.respond({**SPEND, field: value})
    with pytest.raises(LinkResponseError) as caught:
        try:
            await api.call("spend_requests", "retrieve", "sr_123")
        except LinkResponseError:
            logging.getLogger("link-test").exception("Request failed")
            raise
    error = caught.value
    assert error.__cause__ is not None
    assert marker not in str(error.__cause__)
    assert marker not in "".join(traceback.format_exception(error))
    assert marker not in caplog.text


@pytest.mark.parametrize(
    "body, expected",
    [
        ({"error": "string"}, "string"),
        (
            {"error": {"message": "nested", "code": "ignored"}, "message": "ignored"},
            "nested",
        ),
        ({"error": {"code": "code"}}, "code"),
        ({"message": "top"}, "top"),
        ("raw failure", '"raw failure"'),
    ],
)
async def test_error_message_precedence(api: API, body: Any, expected: str) -> None:
    api.respond(body, 400)
    with pytest.raises(LinkAPIError, match=expected) as error:
        await api.call("payment_methods", "list")
    assert json.loads(error.value.raw_body) == body


@pytest.mark.parametrize(
    "raw, message", [("plain text", "plain text"), ("", "unknown error")]
)
async def test_non_json_api_errors(api: API, raw: str, message: str) -> None:
    api.responses.append(httpx.Response(503, text=raw))
    with pytest.raises(LinkAPIError, match=message) as error:
        await api.call("payment_methods", "list")
    assert error.value.raw_body == raw
    assert error.value.details is None


def test_duplicate_extraction_through_causes() -> None:
    data = {
        "id": "sr_dup",
        "status": "future",
        "created_at": "now",
        "updated_at": "now",
    }
    api_error = LinkAPIError(
        "create", 409, "", {"error": {"duplicate_spend_request": data}}
    )
    wrapper = RuntimeError("wrapped")
    wrapper.__cause__ = api_error
    duplicate = get_duplicate_spend_request(wrapper)
    assert duplicate is not None and duplicate.id == "sr_dup"
    for malformed in ({}, {"id": "sr_dup"}, None, {**data, "id": []}):
        error = LinkAPIError(
            "create", 409, "", {"error": {"duplicate_spend_request": malformed}}
        )
        assert get_duplicate_spend_request(error) is None
    wrapper.__cause__ = wrapper
    assert get_duplicate_spend_request(wrapper) is None
    assert get_duplicate_spend_request(ValueError("other")) is None


async def test_async_cancellation_propagates() -> None:
    started = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        started.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        async with AsyncClient(access_token="token", http_client=http) as client:
            task = asyncio.create_task(client.payment_methods.list())
            await started.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task


def test_matching_client_signatures() -> None:
    with Client(access_token="token") as sync:
        async_client = AsyncClient(access_token="token")
        try:
            for resource, methods in {
                "spend_requests": [
                    "create",
                    "list",
                    "update",
                    "retrieve",
                    "cancel",
                    "request_approval",
                ],
                "payment_methods": ["list"],
                "shipping_addresses": ["list"],
                "user_info": ["retrieve"],
                "transactions": ["list"],
                "sources": ["list"],
                "balances": ["list"],
                "reports": ["create"],
                "web_bot_auth": ["sign_url"],
            }.items():
                for method in methods:
                    assert inspect.signature(
                        getattr(getattr(sync, resource), method)
                    ) == inspect.signature(
                        getattr(getattr(async_client, resource), method)
                    )
        finally:
            asyncio.run(async_client.aclose())
