import inspect
from collections import deque
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from link import AsyncClient, Client


class API:
    def __init__(self, mode: str, **options: Any) -> None:
        self.requests: list[httpx.Request] = []
        self.responses: deque[httpx.Response | Exception] = deque()

        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            response = self.responses.popleft()
            if isinstance(response, Exception):
                raise response
            return response

        transport = httpx.MockTransport(handler)
        if "get_access_token" not in options and "access_token" not in options:
            options["access_token"] = "test-token"
        if mode == "async":
            self.http_client = httpx.AsyncClient(transport=transport)
            self.client = AsyncClient(http_client=self.http_client, **options)
        else:
            self.http_client = httpx.Client(transport=transport)
            self.client = Client(http_client=self.http_client, **options)

    def respond(self, data: Any, status: int = 200) -> None:
        self.responses.append(httpx.Response(status, json=data))

    async def call(self, resource: str, method: str, *args: Any, **kwargs: Any) -> Any:
        result = getattr(getattr(self.client, resource), method)(*args, **kwargs)
        return await result if inspect.isawaitable(result) else result

    async def close(self) -> None:
        if isinstance(self.http_client, httpx.AsyncClient):
            await self.http_client.aclose()
        else:
            self.http_client.close()


@pytest.fixture(params=["sync", "async"])
def mode(request: pytest.FixtureRequest) -> str:
    return request.param


@pytest.fixture
async def api(mode: str) -> AsyncIterator[API]:
    instance = API(mode)
    yield instance
    await instance.close()
