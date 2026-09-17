from __future__ import annotations

import unittest

from http_client import Response, request_json


class SingleResponseTransport:
    def __init__(self, response: Response) -> None:
        self.response = response
        self.calls: list[tuple[str, str]] = []

    def send(self, method: str, url: str) -> Response:
        self.calls.append((method, url))
        return self.response


class PublicContractTests(unittest.TestCase):
    def test_get_success_returns_body_once(self) -> None:
        transport = SingleResponseTransport(Response(200, {"ok": True}))
        self.assertEqual(
            request_json(transport, "GET", "/health", sleep=lambda _: None),
            {"ok": True},
        )
        self.assertEqual(transport.calls, [("GET", "/health")])

    def test_post_success_submits_once(self) -> None:
        transport = SingleResponseTransport(Response(201, {"payment_id": "p-1"}))
        self.assertEqual(
            request_json(transport, "POST", "/payments", sleep=lambda _: None),
            {"payment_id": "p-1"},
        )
        self.assertEqual(transport.calls, [("POST", "/payments")])


if __name__ == "__main__":
    unittest.main()
