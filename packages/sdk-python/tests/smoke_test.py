"""Run against the built wheel in an isolated uv environment."""

from importlib.resources import files

from link import AsyncClient, Client, CreateSpendRequestParams, SpendRequest

assert Client.__module__ == "link.client"
assert AsyncClient.__module__ == "link.client"
assert files("link").joinpath("py.typed").is_file()
params: CreateSpendRequestParams = {"context": "A local import smoke test"}
assert "context" in params
assert (
    SpendRequest.model_validate(
        {
            "id": "sr_test",
            "status": "created",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
    ).id
    == "sr_test"
)
