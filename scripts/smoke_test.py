#!/usr/bin/env python3
"""Smoke-test a running Leo backend (local or deployed on Render).

Checks the three things a deployment can silently get wrong:

1. ``/api/health`` answers and the database is connected.
2. ``/openapi.json`` is served and still exposes the voice WebSocket route.
3. ``/ws/process-voice`` completes a handshake and sends its ``ready`` frame
   (the first message the IDE waits for).

Usage:
    python scripts/smoke_test.py
    python scripts/smoke_test.py --url https://leo-voice-agent.onrender.com
    python scripts/smoke_test.py --url http://localhost:8000 --timeout 10

Exit code is 0 only when every check passes. The default timeout is generous
because a free Render instance can take a minute to wake up.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from urllib.parse import urlsplit, urlunsplit

import requests
import websockets

DEFAULT_URL = os.getenv("SMOKE_BASE_URL", "https://leo-voice-agent.onrender.com")
WS_ROUTE = "/ws/process-voice"


class CheckFailed(Exception):
    pass


def http_get(base: str, path: str, timeout: float) -> requests.Response:
    url = base + path
    try:
        response = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:
        raise CheckFailed(f"GET {url} failed: {exc}") from exc
    if response.status_code != 200:
        raise CheckFailed(f"GET {url} returned {response.status_code}")
    return response


def check_health(base: str, timeout: float) -> str:
    body = http_get(base, "/api/health", timeout).json()
    if body.get("status") != "ok":
        raise CheckFailed(f"/api/health reported {body!r}")
    database = body.get("database")
    if database != "connected":
        raise CheckFailed(
            f"/api/health returned database={database!r} "
            "(set DATABASE_URL on the service)"
        )
    return f"status=ok database={database}"


def check_openapi(base: str, timeout: float) -> str:
    spec = http_get(base, "/openapi.json", timeout).json()
    paths = spec.get("paths", {})
    if "/api/health" not in paths:
        raise CheckFailed("/openapi.json does not list /api/health")
    return f"paths={len(paths)}"


async def _await_ready(ws_url: str, timeout: float) -> dict:
    try:
        async with websockets.connect(ws_url, open_timeout=timeout) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout)
    except (OSError, asyncio.TimeoutError, websockets.WebSocketException) as exc:
        raise CheckFailed(f"WS {ws_url} failed: {exc}") from exc
    try:
        message = json.loads(raw)
    except ValueError as exc:
        raise CheckFailed(f"WS {ws_url} sent non-JSON frame: {raw[:120]!r}") from exc
    if message.get("type") != "ready":
        raise CheckFailed(f"WS {ws_url} first frame was {message.get('type')!r}, not 'ready'")
    if not isinstance(message.get("files"), list):
        raise CheckFailed(f"WS {ws_url} 'ready' frame has no files list")
    return message


def check_websocket(base: str, timeout: float) -> str:
    parts = urlsplit(base)
    scheme = "wss" if parts.scheme == "https" else "ws"
    ws_base = urlunsplit((scheme, parts.netloc, parts.path.rstrip("/"), "", ""))
    message = asyncio.run(_await_ready(ws_base + WS_ROUTE, timeout))
    return f"ready files={len(message['files'])}"


CHECKS = (
    ("health", check_health),
    ("openapi", check_openapi),
    ("websocket", check_websocket),
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default=DEFAULT_URL, help=f"base URL (default: {DEFAULT_URL})")
    parser.add_argument("--timeout", type=float, default=90.0, help="per-check timeout in seconds")
    args = parser.parse_args(argv)

    base = args.url.rstrip("/")
    print(f"Smoke-testing {base}")

    failures = 0
    for name, check in CHECKS:
        try:
            detail = check(base, args.timeout)
        except CheckFailed as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
        else:
            print(f"PASS {name}: {detail}")

    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} checks passed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
