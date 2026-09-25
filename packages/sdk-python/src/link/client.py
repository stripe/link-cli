"""Public synchronous and asynchronous Link clients."""

import logging
from collections.abc import Mapping
from types import TracebackType
from typing import Self

import httpx

from . import _async_resources, _resources
from ._transport import (
    NOT_GIVEN,
    AsyncTransport,
    Config,
    NotGiven,
    Transport,
    resolve_timeout,
)
from ._web_bot_auth import AsyncWebBotAuthResource, WebBotAuthResource
from .errors import LinkConfigurationError
from .params import AccessTokenProvider, AsyncAccessTokenProvider


class Client:
    """Typed Link API client accepting caller-managed access credentials."""

    spend_requests: _resources.SpendRequestsResource
    payment_methods: _resources.PaymentMethodsResource
    shipping_addresses: _resources.ShippingAddressesResource
    user_info: _resources.UserInfoResource
    transactions: _resources.TransactionsResource
    sources: _resources.SourcesResource
    balances: _resources.BalancesResource
    reports: _resources.ReportsResource
    web_bot_auth: WebBotAuthResource

    def __init__(
        self,
        *,
        access_token: str | None = None,
        get_access_token: AccessTokenProvider | None = None,
        api_base_url: str = "https://api.link.com",
        spend_request_base_url: str | None = None,
        default_headers: Mapping[str, str] | None = None,
        http_client: httpx.Client | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
        verbose: bool = False,
        logger: logging.Logger | None = None,
    ) -> None:
        if get_access_token is not None and not callable(get_access_token):
            raise LinkConfigurationError("`get_access_token` must be callable.")
        if http_client is not None and not isinstance(http_client, httpx.Client):
            raise LinkConfigurationError("`http_client` must be an httpx.Client.")
        config = Config(
            access_token=access_token,
            has_provider=get_access_token is not None,
            api_base_url=api_base_url,
            spend_request_base_url=spend_request_base_url,
            default_headers=default_headers,
            verbose=verbose,
            logger=logger,
            timeout=resolve_timeout(timeout, http_client),
        )
        self._owns_http_client = http_client is None
        self._http_client = (
            http_client
            if http_client is not None
            else httpx.Client(timeout=config.timeout)
        )
        transport = Transport(config, self._http_client, get_access_token)
        self.spend_requests = _resources.SpendRequestsResource(transport)
        self.payment_methods = _resources.PaymentMethodsResource(transport)
        self.shipping_addresses = _resources.ShippingAddressesResource(transport)
        self.user_info = _resources.UserInfoResource(transport)
        self.transactions = _resources.TransactionsResource(transport)
        self.sources = _resources.SourcesResource(transport)
        self.balances = _resources.BalancesResource(transport)
        self.reports = _resources.ReportsResource(transport)
        self.web_bot_auth = WebBotAuthResource(transport)

    def close(self) -> None:
        """Close SDK-owned connections; injected HTTP clients remain open."""
        if self._owns_http_client:
            self._http_client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


class AsyncClient:
    """Typed Link API client accepting caller-managed access credentials."""

    spend_requests: _async_resources.AsyncSpendRequestsResource
    payment_methods: _async_resources.AsyncPaymentMethodsResource
    shipping_addresses: _async_resources.AsyncShippingAddressesResource
    user_info: _async_resources.AsyncUserInfoResource
    transactions: _async_resources.AsyncTransactionsResource
    sources: _async_resources.AsyncSourcesResource
    balances: _async_resources.AsyncBalancesResource
    reports: _async_resources.AsyncReportsResource
    web_bot_auth: AsyncWebBotAuthResource

    def __init__(
        self,
        *,
        access_token: str | None = None,
        get_access_token: AsyncAccessTokenProvider | None = None,
        api_base_url: str = "https://api.link.com",
        spend_request_base_url: str | None = None,
        default_headers: Mapping[str, str] | None = None,
        http_client: httpx.AsyncClient | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = NOT_GIVEN,
        verbose: bool = False,
        logger: logging.Logger | None = None,
    ) -> None:
        if get_access_token is not None and not callable(get_access_token):
            raise LinkConfigurationError("`get_access_token` must be callable.")
        if http_client is not None and not isinstance(http_client, httpx.AsyncClient):
            raise LinkConfigurationError("`http_client` must be an httpx.AsyncClient.")
        config = Config(
            access_token=access_token,
            has_provider=get_access_token is not None,
            api_base_url=api_base_url,
            spend_request_base_url=spend_request_base_url,
            default_headers=default_headers,
            verbose=verbose,
            logger=logger,
            timeout=resolve_timeout(timeout, http_client),
        )
        self._owns_http_client = http_client is None
        self._http_client = (
            http_client
            if http_client is not None
            else httpx.AsyncClient(timeout=config.timeout)
        )
        transport = AsyncTransport(config, self._http_client, get_access_token)
        self.spend_requests = _async_resources.AsyncSpendRequestsResource(transport)
        self.payment_methods = _async_resources.AsyncPaymentMethodsResource(transport)
        self.shipping_addresses = _async_resources.AsyncShippingAddressesResource(
            transport
        )
        self.user_info = _async_resources.AsyncUserInfoResource(transport)
        self.transactions = _async_resources.AsyncTransactionsResource(transport)
        self.sources = _async_resources.AsyncSourcesResource(transport)
        self.balances = _async_resources.AsyncBalancesResource(transport)
        self.reports = _async_resources.AsyncReportsResource(transport)
        self.web_bot_auth = AsyncWebBotAuthResource(transport)

    async def aclose(self) -> None:
        """Close SDK-owned connections; injected HTTP clients remain open."""
        if self._owns_http_client:
            await self._http_client.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()
