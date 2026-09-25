import pytest
from fixtures import BALANCE, SPEND
from pydantic import BaseModel, ValidationError

from link import (
    Balance,
    BalancesPage,
    PaymentMethod,
    Source,
    SourcesPage,
    SpendLimit,
    SpendRequest,
    TransactionsPage,
    UserInfo,
)


def test_spend_request_full_response() -> None:
    data = {
        "id": "sr_1",
        "merchant_name": "Acme",
        "merchant_url": "https://acme.example",
        "context": "purchase",
        "amount": 2599,
        "currency": "usd",
        "line_items": [
            {
                "name": "item",
                "url": "url",
                "image_url": "image",
                "description": "desc",
                "sku": "sku",
                "totals": [],
                "quantity": 1,
                "unit_amount": 2599,
                "product_url": "product",
            }
        ],
        "totals": [],
        "payment_method": "pm_1",
        "payment_details": "pd_1",
        "credential_type": "card",
        "network_id": "network",
        "card_brand": "visa",
        "card_last4": "4242",
        "status": "requires_action",
        "approval_url": "https://link.com/approve",
        "card": {
            "id": "card_1",
            "brand": "visa",
            "exp_month": 12,
            "exp_year": 2027,
            "number": "4242424242424242",
            "cvc": "123",
            "valid_until": "now",
            "billing_address": {
                "name": "User",
                "line1": "123 Main",
                "line2": None,
                "city": "NYC",
                "state": "NY",
                "postal_code": "10001",
                "country": "US",
            },
        },
        "shared_payment_token": {"id": "spt_secret", "valid_until": "now"},
        "link_pay_token": "lpt_secret",
        "payment_status_details": {
            "outcome": "failure",
            "code": "declined",
            "decline_code": "funds",
            "amount": 2599,
            "currency": "usd",
            "created": 123,
            "refund_details": {
                "amount": 100,
                "currency": "usd",
                "state": "pending",
                "created": 124,
            },
        },
        "status_details": {
            "requires_action": {
                "failure_code": None,
                "next_action": {
                    "type": "three_d_secure",
                    "resolution": "auto_resume",
                    "display_message": "Authenticate",
                    "action_url": "https://example.com/action",
                    "expires_at": 456,
                },
            }
        },
        "link_transaction_id": "tx_1",
        "activity_url": "https://link.com/activity",
        "metadata": {},
        "expires_at": 789,
        "created_at": "now",
        "updated_at": "later",
    }
    request = SpendRequest.model_validate(data)
    assert request.model_dump(exclude_unset=True) == data
    for secret in ("4242424242424242", "spt_secret", "lpt_secret"):
        assert secret not in repr(request)


@pytest.mark.parametrize(
    "model, data",
    [
        (TransactionsPage, {"data": [], "has_more": True, "next_cursor": "opaque"}),
        (
            SourcesPage,
            {
                "data": [{"granted_actions": [], "future": {"enabled": True}}],
                "extra": [1, 2],
            },
        ),
        (BalancesPage, {"data": [], "extra": None}),
        (
            Source,
            {
                "id": "source",
                "future": {"anything": 123},
                "capabilities": {"new": True},
            },
        ),
        (Balance, {**BALANCE, "type": "future", "extra": 5}),
    ],
)
def test_forward_fields_roundtrip(model: type[BaseModel], data: dict) -> None:
    value = model.model_validate(data)
    assert value.model_dump(exclude_unset=True) == data
    assert value.model_extra


def test_optional_fields_remain_optional() -> None:
    method = PaymentMethod(id="pm_1", type="card", is_default=False, name="Visa")
    assert method.nickname is None
    assert SpendRequest.model_validate(SPEND).amount is None
    assert TransactionsPage(data=[]).data == []
    assert UserInfo.model_validate({}).agent_wallet_spend_limits is None


@pytest.mark.parametrize("amount", [True, "123", 1.5, 123.0])
def test_no_scalar_coercion(amount: object) -> None:
    with pytest.raises(ValidationError) as caught:
        SpendRequest.model_validate({**SPEND, "amount": amount})
    assert caught.value.errors()[0]["loc"] == ("amount",)


@pytest.mark.parametrize("field", ["id", "status", "created_at", "updated_at"])
@pytest.mark.parametrize("explicit_null", [False, True])
def test_required_fields_reject_omission_and_null(
    field: str, explicit_null: bool
) -> None:
    data: dict = dict(SPEND)
    if explicit_null:
        data[field] = None
    else:
        del data[field]
    with pytest.raises(ValidationError) as caught:
        SpendRequest.model_validate(data)
    assert caught.value.errors()[0]["loc"][0] == field


def test_missing_limits_are_not_interpreted_as_unlimited() -> None:
    assert SpendLimit(limit=None).limit is None
    with pytest.raises(ValidationError):
        SpendLimit.model_validate({})
    with pytest.raises(ValidationError):
        UserInfo.model_validate({"agent_wallet_spend_limits": {}})


def test_optional_field_presence_and_future_status_are_preserved() -> None:
    omitted = SpendRequest.model_validate({**SPEND, "status": "future_status"})
    explicit = SpendRequest.model_validate({**SPEND, "amount": None})
    assert omitted.status == "future_status"
    assert "amount" not in omitted.model_fields_set
    assert "amount" in explicit.model_fields_set
    assert "amount" not in omitted.model_dump(exclude_unset=True)
    assert explicit.model_dump(exclude_unset=True)["amount"] is None
