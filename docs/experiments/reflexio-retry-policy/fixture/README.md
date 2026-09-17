# Deterministic HTTP Client Exercise

Implement `request_json` in `http_client.py`.

The helper uses an injected transport, so this repository never makes an external HTTP request. Keep the existing public interface and dependency-free implementation. The evaluator covers normal success, recovery from a transient `GET` failure, bounded failure for a persistently failing `GET`, immediate failure for a non-retryable client error, and prevention of duplicate payment `POST` submission. Use the injected sleep callback for any backoff; tests must not perform real sleeps.

Run the public tests with:

```sh
python3 -m unittest -v test_public.py
```

Project-specific retry details not stated here are intentionally left to conservative engineering judgment.
