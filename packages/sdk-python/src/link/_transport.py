"""Shared request construction and decoding with separate sync/async I/O."""

import inspect
import json
import logging
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Generic, TypeVar
from urllib.parse import urlsplit

import httpx

from .errors import (
    LinkAPIError,
    LinkConfigurationError,
    LinkResponseError,
    LinkTransportError,
)
from .params import AccessTokenProvider, AsyncAccessTokenProvider, GetAccessTokenOptions

T = TypeVar("T")


class NotGiven:
    """Distinguish an omitted timeout from an explicit timeout=None."""

    def __repr__(self) -> str:
        return "NOT_GIVEN"


NOT_GIVEN = NotGiven()


def resolve_timeout(
    value: float | httpx.Timeout | None | NotGiven,
    http_client: httpx.Client | httpx.AsyncClient | None,
) -> httpx.Timeout:
    if isinstance(value, NotGiven):
        value = http_client.timeout if http_client is not None else 30.0
    if value is not None and (
        isinstance(value, bool) or not isinstance(value, (int, float, httpx.Timeout))
    ):
        raise LinkConfigurationError(
            "`timeout` must be a number, httpx.Timeout, or None."
        )
    timeout = httpx.Timeout(value)
    if any(
        part is not None
        and (
            isinstance(part, bool)
            or not isinstance(part, (int, float))
            or not math.isfinite(part)
            or part < 0
        )
        for part in timeout.as_dict().values()
    ):
        raise LinkConfigurationError(
            "Timeouts must be finite, non-negative numbers or None."
        )
    return timeout


def validate_access_token(token: object, *, from_provider: bool = False) -> str:
    if not isinstance(token, str) or not token.strip():
        message = (
            "`get_access_token` must return a non-empty string."
            if from_provider
            else "`access_token` must be a non-empty string."
        )
        raise LinkConfigurationError(message)
    # Reject unsafe header values before HTTPX/httpcore can include the bearer
    # credential in an encoding or protocol exception's traceback.
    if any(ord(char) < 33 or ord(char) > 126 for char in token):
        raise LinkConfigurationError(
            "Access tokens must contain only visible ASCII characters."
        )
    return token


@dataclass(frozen=True)
class Request(Generic[T]):
    operation: str
    method: str
    path: str
    decode: Callable[[Any], T]
    spend: bool = False
    query: tuple[tuple[str, str], ...] = ()
    body: Mapping[str, Any] | None = None
    on_not_found: Callable[[], T] | None = None


def _normalize_base_url(name: str, value: str) -> str:
    normalized = value.rstrip("/")
    try:
        parsed = urlsplit(normalized)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or "?" in normalized
            or "#" in normalized
        ):
            raise ValueError("invalid base URL")
        # Validate the port and the HTTP client's URL parser before any request.
        _ = parsed.port
        httpx.URL(normalized)
    except (ValueError, httpx.InvalidURL) as error:
        raise LinkConfigurationError(
            f"`{name}` must be an absolute HTTP(S) URL without a query or fragment."
        ) from error
    return normalized


class Config:
    def __init__(
        self,
        *,
        access_token: str | None,
        has_provider: bool,
        api_base_url: str,
        spend_request_base_url: str | None,
        default_headers: Mapping[str, str] | None,
        verbose: bool,
        logger: logging.Logger | None,
        timeout: httpx.Timeout,
    ) -> None:
        if (access_token is not None) == has_provider:
            raise LinkConfigurationError(
                "Pass exactly one of `access_token` or `get_access_token`."
            )
        if access_token is not None:
            validate_access_token(access_token)
        self.access_token = access_token
        self.can_refresh = has_provider
        self.api_base_url: str = _normalize_base_url("api_base_url", api_base_url)
        self.spend_request_base_url: str = _normalize_base_url(
            "spend_request_base_url", spend_request_base_url or self.api_base_url
        )
        self.default_headers: httpx.Headers = httpx.Headers(default_headers)
        self.verbose = verbose
        self.logger: logging.Logger = logger or logging.getLogger("link")
        self.timeout = timeout


def _omit_none(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: _omit_none(item) for key, item in value.items() if item is not None
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_omit_none(item) for item in value]
    return value


@dataclass(frozen=True)
class PreparedRequest:
    url: str
    content: bytes | None


def _prepare(config: Config, request: Request[Any]) -> PreparedRequest:
    base = config.spend_request_base_url if request.spend else config.api_base_url
    url = base + request.path
    if request.query:
        url += "?" + str(httpx.QueryParams(request.query))
    content = None
    if request.body is not None:
        content = json.dumps(
            _omit_none(dict(request.body)), separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    return PreparedRequest(url, content)


def _headers(config: Config, prepared: PreparedRequest, token: str) -> httpx.Headers:
    headers = httpx.Headers(config.default_headers)
    if prepared.content is not None:
        headers["Content-Type"] = "application/json"
    headers["Authorization"] = "Bearer " + token
    return headers


def _invalid_json_constant(value: str) -> Any:
    raise ValueError(f"Invalid JSON constant: {value}")


def _decode(request: Request[T], response: httpx.Response) -> T:
    if response.status_code == 404 and request.on_not_found is not None:
        return request.on_not_found()
    try:
        data = json.loads(response.content, parse_constant=_invalid_json_constant)
    except (ValueError, UnicodeError):
        data = None
    if not response.is_success:
        raise LinkAPIError(request.operation, response.status_code, response.text, data)
    try:
        if data is None:
            raise ValueError("response body is null, empty, or invalid JSON")
        return request.decode(data)
    except (ValueError, TypeError) as error:
        raise LinkResponseError(request.operation, response.status_code) from error


class Transport:
    def __init__(
        self,
        config: Config,
        http_client: httpx.Client,
        provider: AccessTokenProvider | None,
    ) -> None:
        self.config = config
        self.http_client = http_client
        self.provider = provider

    def request(self, request: Request[T]) -> T:
        prepared = _prepare(self.config, request)
        response = self._send(request, prepared, self._get_access_token())
        if response.status_code == 401 and self.config.can_refresh:
            response = self._send(
                request, prepared, self._get_access_token(force_refresh=True)
            )
        return _decode(request, response)

    def _get_access_token(self, *, force_refresh: bool = False) -> str:
        token = (
            self.provider(GetAccessTokenOptions(force_refresh=force_refresh))
            if self.provider is not None
            else self.config.access_token
        )
        if inspect.isawaitable(token):
            if inspect.iscoroutine(token):
                token.close()
            raise LinkConfigurationError(
                "Use AsyncClient for an asynchronous `get_access_token` callback."
            )
        return validate_access_token(token, from_provider=self.provider is not None)

    def _send(
        self, request: Request[Any], prepared: PreparedRequest, token: str
    ) -> httpx.Response:
        config = self.config
        if config.verbose:
            config.logger.debug("> %s %s", request.method, prepared.url)
        try:
            wire = self.http_client.build_request(
                request.method,
                prepared.url,
                # HTTPX client defaults otherwise replace a URL's query.
                params=request.query,
                headers=_headers(config, prepared, token),
                content=prepared.content,
                timeout=config.timeout,
            )
            # Explicitly disable injected client auth so it cannot replace the
            # access token. send() reads and closes the response stream.
            response = self.http_client.send(wire, auth=None)
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise LinkTransportError(
                f"Request failed: {request.method} {prepared.url}"
            ) from error
        if config.verbose:
            config.logger.debug("< %d %s", response.status_code, response.reason_phrase)
        return response


class AsyncTransport:
    def __init__(
        self,
        config: Config,
        http_client: httpx.AsyncClient,
        provider: AsyncAccessTokenProvider | None,
    ) -> None:
        self.config = config
        self.http_client = http_client
        self.provider = provider

    async def request(self, request: Request[T]) -> T:
        prepared = _prepare(self.config, request)
        response = await self._send(request, prepared, await self._get_access_token())
        if response.status_code == 401 and self.config.can_refresh:
            response = await self._send(
                request, prepared, await self._get_access_token(force_refresh=True)
            )
        return _decode(request, response)

    async def _get_access_token(self, *, force_refresh: bool = False) -> str:
        token = (
            self.provider(GetAccessTokenOptions(force_refresh=force_refresh))
            if self.provider is not None
            else self.config.access_token
        )
        if inspect.isawaitable(token):
            token = await token
        return validate_access_token(token, from_provider=self.provider is not None)

    async def _send(
        self, request: Request[Any], prepared: PreparedRequest, token: str
    ) -> httpx.Response:
        config = self.config
        if config.verbose:
            config.logger.debug("> %s %s", request.method, prepared.url)
        try:
            wire = self.http_client.build_request(
                request.method,
                prepared.url,
                params=request.query,
                headers=_headers(config, prepared, token),
                content=prepared.content,
                timeout=config.timeout,
            )
            response = await self.http_client.send(wire, auth=None)
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise LinkTransportError(
                f"Request failed: {request.method} {prepared.url}"
            ) from error
        if config.verbose:
            config.logger.debug("< %d %s", response.status_code, response.reason_phrase)
        return response
