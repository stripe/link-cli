"""Typed Link resources. Wire behavior is shared in _operations."""

from __future__ import annotations

import builtins
from collections.abc import Mapping, Sequence

from . import _operations as op
from ._transport import Transport
from ._types import (
    CredentialType,
    ExecutionMethod,
    ReportOutcome,
    ReportTag,
    TransactionOrigin,
)
from .models import (
    BalancesPage,
    PaymentMethod,
    ReportRecord,
    RequestApprovalResponse,
    ShippingAddressRecord,
    SourcesPage,
    SpendRequest,
    TransactionsPage,
    UserInfo,
)
from .params import (
    ApprovalDetailParams,
    CreateReportParams,
    CreateSpendRequestParams,
    LineItemParams,
    ListBalancesParams,
    ListSourcesParams,
    ListTransactionsParams,
    TotalParams,
    UpdateSpendRequestParams,
)


class SpendRequestsResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        include_history: bool = False,
    ) -> builtins.list[SpendRequest]:
        """List spend requests."""
        return self._transport.request(op.spend_list(include_history))

    def create(
        self,
        *,
        context: str,
        idempotency_key: str | None = None,
        payment_details: str | None = None,
        credential_type: CredentialType | None = None,
        network_id: str | None = None,
        execution_method: ExecutionMethod | None = None,
        merchant_account_id: str | None = None,
        amount: int | None = None,
        currency: str | None = None,
        merchant_name: str | None = None,
        merchant_url: str | None = None,
        line_items: Sequence[LineItemParams] | None = None,
        totals: Sequence[TotalParams] | None = None,
        request_approval: bool | None = None,
        test: bool | None = None,
        approval_details: ApprovalDetailParams | None = None,
        metadata: Mapping[str, str] | None = None,
    ) -> SpendRequest:
        """Create a spend request."""
        params: CreateSpendRequestParams = {
            "context": context,
            "idempotency_key": idempotency_key,
            "payment_details": payment_details,
            "credential_type": credential_type,
            "network_id": network_id,
            "execution_method": execution_method,
            "merchant_account_id": merchant_account_id,
            "amount": amount,
            "currency": currency,
            "merchant_name": merchant_name,
            "merchant_url": merchant_url,
            "line_items": line_items,
            "totals": totals,
            "request_approval": request_approval,
            "test": test,
            "approval_details": approval_details,
            "metadata": metadata,
        }
        return self._transport.request(op.spend_create(params))

    def update(
        self,
        id: str,
        *,
        payment_details: str | None = None,
        amount: int | None = None,
        merchant_url: str | None = None,
        profile_id: str | None = None,
        merchant_id: str | None = None,
        currency: str | None = None,
        line_items: Sequence[LineItemParams] | None = None,
        totals: Sequence[TotalParams] | None = None,
    ) -> SpendRequest:
        """Update mutable fields on a spend request."""
        params: UpdateSpendRequestParams = {
            "payment_details": payment_details,
            "amount": amount,
            "merchant_url": merchant_url,
            "profile_id": profile_id,
            "merchant_id": merchant_id,
            "currency": currency,
            "line_items": line_items,
            "totals": totals,
        }
        return self._transport.request(op.spend_update(id, params))

    def retrieve(
        self,
        id: str,
        *,
        include: Sequence[str] | None = None,
    ) -> SpendRequest | None:
        """Retrieve a spend request, or return None when it does not exist."""
        return self._transport.request(op.spend_retrieve(id, include))

    def request_approval(self, id: str) -> RequestApprovalResponse:
        """Ask the Link user to approve a spend request."""
        return self._transport.request(op.spend_approve(id))

    def cancel(self, id: str) -> SpendRequest:
        """Cancel a spend request."""
        return self._transport.request(op.spend_cancel(id))


class PaymentMethodsResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def list(self) -> builtins.list[PaymentMethod]:
        """List payment methods."""
        return self._transport.request(op.payment_methods())


class ShippingAddressesResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def list(self) -> builtins.list[ShippingAddressRecord]:
        """List shipping addresses."""
        return self._transport.request(op.shipping_addresses())


class UserInfoResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def retrieve(self) -> UserInfo:
        """Retrieve user info."""
        return self._transport.request(op.user_info())


class TransactionsResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        limit: int | None = None,
        starting_after: str | None = None,
        ending_before: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        category: str | None = None,
        origin: TransactionOrigin | None = None,
        sources: Sequence[str] | None = None,
    ) -> TransactionsPage:
        """List transactions."""
        params: ListTransactionsParams = {
            "limit": limit,
            "starting_after": starting_after,
            "ending_before": ending_before,
            "start_date": start_date,
            "end_date": end_date,
            "category": category,
            "origin": origin,
            "sources": sources,
        }
        return self._transport.request(op.transactions(params))


class SourcesResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        limit: int | None = None,
        starting_after: str | None = None,
        ending_before: str | None = None,
    ) -> SourcesPage:
        """List sources."""
        params: ListSourcesParams = {
            "limit": limit,
            "starting_after": starting_after,
            "ending_before": ending_before,
        }
        return self._transport.request(op.sources(params))


class BalancesResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def list(
        self,
        *,
        limit: int | None = None,
        starting_after: str | None = None,
        ending_before: str | None = None,
        sources: Sequence[str] | None = None,
    ) -> BalancesPage:
        """List balances."""
        params: ListBalancesParams = {
            "limit": limit,
            "starting_after": starting_after,
            "ending_before": ending_before,
            "sources": sources,
        }
        return self._transport.request(op.balances(params))


class ReportsResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def create(
        self,
        *,
        domain: str,
        outcome: ReportOutcome,
        spend_request_id: str,
        tags: Sequence[ReportTag] | None = None,
        step: str | None = None,
        freeform_context: str | None = None,
    ) -> ReportRecord:
        """Record an agent outcome."""
        params: CreateReportParams = {
            "domain": domain,
            "outcome": outcome,
            "spend_request_id": spend_request_id,
            "tags": tags,
            "step": step,
            "freeform_context": freeform_context,
        }
        return self._transport.request(op.report_create(params))
