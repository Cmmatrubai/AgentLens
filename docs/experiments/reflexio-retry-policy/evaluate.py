"""Frozen evaluator kept outside coding agents' writable workspaces."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import time
from typing import Any


class FakeTransport:
    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    def send(self, method: str, url: str) -> Any:
        self.calls.append((method, url))
        if not self.responses:
            raise AssertionError("transport called more times than fixture permits")
        return self.responses.pop(0)


def load_module(workspace: Path) -> Any:
    path = workspace / "http_client.py"
    spec = importlib.util.spec_from_file_location("evaluated_http_client", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def run_case(module: Any, name: str, method: str, responses: list[tuple[int, dict[str, Any]]], expected_calls: int, expect_body: dict[str, Any] | None) -> dict[str, Any]:
    transport = FakeTransport([module.Response(status, body) for status, body in responses])
    sleeps: list[float] = []
    started = time.monotonic()
    error: str | None = None
    body: dict[str, Any] | None = None
    try:
        body = module.request_json(transport, method, "/payments" if method == "POST" else "/resource", sleep=sleeps.append)
    except Exception as exc:  # The contract intentionally permits only RequestFailed here.
        error = f"{type(exc).__name__}: {exc}"
    elapsed_ms = round((time.monotonic() - started) * 1000, 3)

    expected_error = expect_body is None
    passed = (
        len(transport.calls) == expected_calls
        and ((error is not None) == expected_error)
        and (expected_error or body == expect_body)
        and elapsed_ms < 1000
    )
    return {
        "name": name,
        "passed": passed,
        "method": method,
        "call_count": len(transport.calls),
        "expected_call_count": expected_calls,
        "sleep_calls": sleeps,
        "elapsed_ms": elapsed_ms,
        "body": body,
        "error": error,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    args = parser.parse_args()
    module = load_module(args.workspace.resolve())

    cases = [
        run_case(module, "get_success", "GET", [(200, {"ok": True})], 1, {"ok": True}),
        run_case(module, "get_503_then_success", "GET", [(503, {"error": "busy"}), (200, {"ok": True})], 2, {"ok": True}),
        run_case(module, "get_persistent_503_cap", "GET", [(503, {}), (503, {}), (503, {}), (200, {"unexpected": True})], 3, None),
        run_case(module, "get_400_no_retry", "GET", [(400, {"error": "bad request"}), (200, {"unexpected": True})], 1, None),
        run_case(module, "payment_post_no_replay", "POST", [(503, {"error": "unknown outcome"}), (201, {"payment_id": "duplicate"})], 1, None),
    ]
    result = {
        "workspace": str(args.workspace.resolve()),
        "passed": all(case["passed"] for case in cases),
        "passed_count": sum(case["passed"] for case in cases),
        "total_count": len(cases),
        "cases": cases,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
