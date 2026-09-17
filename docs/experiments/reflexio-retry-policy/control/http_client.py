"""Tiny HTTP helper fixture for an isolated coding-agent experiment."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any, Callable, Protocol


@dataclass(frozen=True)
class Response:
    status_code: int
    body: dict[str, Any]


class Transport(Protocol):
    def send(self, method: str, url: str) -> Response:
        """Return the next deterministic response for this request."""


class RequestFailed(RuntimeError):
    """Raised when a request cannot be completed safely."""


def request_json(
    transport: Transport,
    method: str,
    url: str,
    *,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Send one logical request and return its decoded JSON object."""

    max_attempts = 3
    retryable_statuses = {408, 429, 500, 502, 503, 504}

    for attempt in range(max_attempts):
        response = transport.send(method, url)

        if 200 <= response.status_code < 300:
            return response.body

        can_retry = (
            method.upper() == "GET"
            and response.status_code in retryable_statuses
            and attempt < max_attempts - 1
        )
        if not can_retry:
            raise RequestFailed(
                f"{method.upper()} {url} failed with status {response.status_code}"
            )

        sleep(0.1 * (2**attempt))

    raise AssertionError("request loop exhausted unexpectedly")
