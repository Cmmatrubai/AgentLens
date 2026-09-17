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

    raise NotImplementedError("Implement request_json")
