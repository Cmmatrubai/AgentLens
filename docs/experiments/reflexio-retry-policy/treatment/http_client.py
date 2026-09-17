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

    retryable_statuses = {502, 503, 504}
    max_attempts = 3 if method.upper() == "GET" else 1

    for attempt in range(1, max_attempts + 1):
        response = transport.send(method, url)
        if 200 <= response.status_code < 300:
            return response.body

        should_retry = (
            response.status_code in retryable_statuses and attempt < max_attempts
        )
        if not should_retry:
            raise RequestFailed(
                f"{method} {url} failed with status {response.status_code} "
                f"after {attempt} attempt(s)"
            )

        sleep(2 ** (attempt - 1))

    raise AssertionError("request loop exited unexpectedly")
