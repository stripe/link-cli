"""Per-client Web Bot Auth cache, shared across paths and ports on a hostname."""

from datetime import UTC, datetime, timedelta
from threading import Lock
from urllib.parse import urlsplit

from ._operations import signing_expiry, web_bot_sign
from ._transport import AsyncTransport, Transport
from .errors import LinkSDKError
from .models import WebBotAuthBlock


def _now() -> datetime:
    return datetime.now(UTC)


def _authority(url: str) -> str:
    try:
        parsed = urlsplit(url)
        if not parsed.scheme or not parsed.hostname:
            raise ValueError("URL must be absolute")
        _ = parsed.port
        return parsed.hostname
    except ValueError as error:
        raise LinkSDKError("Invalid URL: " + url) from error


class _Cache:
    def __init__(self) -> None:
        self._lock = Lock()
        self._entries: dict[str, tuple[datetime, WebBotAuthBlock]] = {}

    def get(self, authority: str) -> WebBotAuthBlock | None:
        with self._lock:
            cached = self._entries.get(authority)
            if cached and cached[0] - _now() > timedelta(seconds=30):
                return cached[1].model_copy(deep=True)
        return None

    def put(self, authority: str, block: WebBotAuthBlock) -> None:
        expiry = signing_expiry(block.expires_at)
        with self._lock:
            self._entries[authority] = (expiry, block.model_copy(deep=True))


class WebBotAuthResource:
    def __init__(self, transport: Transport) -> None:
        self._transport = transport
        self._cache = _Cache()

    def sign_url(self, url: str) -> WebBotAuthBlock:
        """Sign a merchant URL; cache by hostname until 30s before expiry."""
        authority = _authority(url)
        cached = self._cache.get(authority)
        if cached is not None:
            return cached
        block = self._transport.request(web_bot_sign(url))
        self._cache.put(authority, block)
        return block


class AsyncWebBotAuthResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._transport = transport
        self._cache = _Cache()

    async def sign_url(self, url: str) -> WebBotAuthBlock:
        """Sign a merchant URL; cache by hostname until 30s before expiry."""
        authority = _authority(url)
        cached = self._cache.get(authority)
        if cached is not None:
            return cached
        block = await self._transport.request(web_bot_sign(url))
        self._cache.put(authority, block)
        return block
