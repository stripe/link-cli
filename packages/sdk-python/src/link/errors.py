"""Typed SDK errors and duplicate spend-request recovery."""

from typing import Any

from pydantic import ValidationError

from .models import SpendRequest


class LinkError(Exception):
    """Base class for SDK-created errors; provider exceptions pass through."""

    code = "sdk_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class LinkSDKError(LinkError):
    pass


class LinkConfigurationError(LinkSDKError):
    code = "configuration_error"


class LinkTransportError(LinkSDKError):
    code = "transport_error"


class LinkResponseError(LinkSDKError):
    code = "invalid_response"

    def __init__(self, operation: str, status: int) -> None:
        super().__init__(f"Invalid response while attempting to {operation} ({status})")
        self.status = status


class LinkAPIError(LinkSDKError):
    code = "api_error"

    def __init__(
        self, operation: str, status: int, raw_body: str, details: Any = None
    ) -> None:
        message = _error_message(details, raw_body)
        super().__init__(f"Failed to {operation} ({status}): {message}")
        self.status = status
        self.raw_body = raw_body
        self.details = details


def _error_message(data: Any, raw_body: str) -> str:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, str):
            return error
        if isinstance(error, dict):
            for key in ("message", "code"):
                value = error.get(key)
                if isinstance(value, str):
                    return value
        message = data.get("message")
        if isinstance(message, str):
            return message
    return raw_body or "unknown error"


def get_duplicate_spend_request(error: BaseException) -> SpendRequest | None:
    """Find a valid duplicate in an API error, following exception causes."""
    seen: set[int] = set()
    while id(error) not in seen:
        seen.add(id(error))
        if isinstance(error, LinkAPIError):
            details = error.details
            if not isinstance(details, dict) or not isinstance(
                details.get("error"), dict
            ):
                return None
            duplicate = details["error"].get("duplicate_spend_request")
            try:
                request = SpendRequest.model_validate(duplicate)
            except ValidationError:
                return None
            if all(
                (request.id, request.status, request.created_at, request.updated_at)
            ):
                return request
            return None
        cause = error.__cause__
        if cause is None and not error.__suppress_context__:
            cause = error.__context__
        if cause is None:
            return None
        error = cause
    return None
