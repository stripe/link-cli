"""Check the public API as a typed consumer, including rejected request values."""

import subprocess
import sys
from pathlib import Path


def test_public_request_types(tmp_path: Path) -> None:
    example = tmp_path / "consumer.py"
    example.write_text("""
from typing import assert_type
from types import MappingProxyType
from link import AsyncClient, Client, LineItemParams, SpendRequest, PaymentMethod
from link import JsonPrimitive, JsonValue, SpendRequestStatus

future_status: SpendRequestStatus = "future_status"
primitive: JsonPrimitive = None
json_value: JsonValue = {"items": [primitive, {"active": True}], "amount": 1.25}

def valid(client: Client) -> None:
    item: LineItemParams = {"name": "Item", "totals": ()}
    result = client.spend_requests.create(
        context="The user requested this purchase.",
        credential_type="card",
        execution_method="link_pay_token",
        line_items=(item,),
        metadata=MappingProxyType({"order": "123"}),
    )
    assert_type(result, SpendRequest)
    assert_type(client.payment_methods.list(), list[PaymentMethod])
    assert_type(client.spend_requests.retrieve("sr_1"), SpendRequest | None)
    client.reports.create(
        domain="example.com", outcome="success", spend_request_id="sr_1"
    )
    client.spend_requests.create(
        context="Purchase", line_items=[{"name": "Item", "totals": []}],
        approval_details={"approved_at": 1, "approval_method": "voice",
                          "app_name": "app", "external_user_id": "user"},
    )

async def valid_async(client: AsyncClient) -> None:
    result = await client.spend_requests.create(
        context="Purchase", credential_type="card"
    )
    assert_type(result, SpendRequest)
""")
    command = [
        sys.executable,
        "-m",
        "ty",
        "check",
        "--project",
        str(Path(__file__).resolve().parents[1]),
        str(example),
        "--output-format",
        "concise",
    ]
    valid = subprocess.run(command, capture_output=True, text=True, check=False)
    assert valid.returncode == 0, valid.stdout + valid.stderr

    # Each expression must fail independently: broadening a request Literal to
    # `str` would otherwise mask misspelled values from consumers' type checkers.
    invalid_calls = [
        'client.spend_requests.create(context="Purchase", credential_type="typo")',
        'client.spend_requests.create(context="Purchase", execution_method="typo")',
        'client.transactions.list(origin="typo")',
        (
            'client.reports.create(domain="example.com", outcome="typo", '
            'spend_request_id="sr_1")'
        ),
        (
            'client.reports.create(domain="example.com", outcome="success", '
            'spend_request_id="sr_1", tags=("typo",))'
        ),
        (
            'client.spend_requests.create(context="Purchase", approval_details={'
            '"approved_at": 1, "approval_method": "typo", "app_name": "app", '
            '"external_user_id": "user"})'
        ),
    ]
    for call in invalid_calls:
        example.write_text(
            "from link import Client\ndef invalid(client: Client) -> None:\n"
            f"    {call}\n"
        )
        invalid = subprocess.run(command, capture_output=True, text=True, check=False)
        output = invalid.stdout + invalid.stderr
        assert invalid.returncode == 1, output
        assert "invalid-argument-type" in output, output
