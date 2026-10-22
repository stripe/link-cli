import pytest
from conftest import API

from link import (
    ApprovalPolicy,
    LinkResponseError,
)


async def test_retrieve_approval_policy(api: API) -> None:
    api.respond(
        {
            "rules": [
                {
                    "action": "spend_request_create",
                    "limits": {"per_purchase": {"amount": 5000, "currency": "usd"}},
                    "allowed_payment_methods": ["pd_1"],
                },
                {
                    "action": "future_action",
                    "limits": {"per_purchase": {"amount": 1, "currency": "eur"}},
                    "future": True,
                },
            ]
        }
    )
    policy = await api.call("approval_policy", "retrieve")
    assert isinstance(policy, ApprovalPolicy)
    assert api.requests[0].method == "GET"
    assert api.requests[0].url == "https://api.link.com/approval-policy"
    assert policy.rules[0].limits.per_purchase.amount == 5000
    assert policy.rules[1].action == "future_action"
    assert policy.rules[1].model_extra == {"future": True}

    api.respond({"rules": [{"action": "x"}]})
    with pytest.raises(LinkResponseError, match="retrieve approval policy"):
        await api.call("approval_policy", "retrieve")
