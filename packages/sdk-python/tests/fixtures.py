"""Complete API payloads shared by transport and resource tests."""

SPEND = {
    "id": "sr_123",
    "status": "created",
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z",
}
CARD = {
    "id": "card_1",
    "brand": "visa",
    "exp_month": 12,
    "exp_year": 2027,
    "number": "synthetic-card-number",
}
TRANSACTION = {
    "id": "tx_1",
    "source_id": None,
    "amount": 2599,
    "currency": "usd",
    "created_date": "2026-01-01",
    "description": "Purchase",
    "origin": "link",
    "category": None,
    "status": "succeeded",
}
BALANCE = {
    "source_id": "source_1",
    "type": "cash",
    "current": 0,
    "currency": "usd",
    "as_of": "2026-01-01T00:00:00Z",
    "cash": {"available": {"usd": 123}},
}
ADDRESS = {
    "name": None,
    "line_1": "123 Main",
    "line_2": None,
    "locality": None,
    "dependent_locality": None,
    "administrative_area": None,
    "postal_code": None,
    "sorting_code": None,
    "country_code": None,
}
