"""LLM provider with configurable fallback/routing (Gemini + Groq).

- Falls back on transient/retryable failures (rate limits, quota, timeouts,
  5xx/overloaded) and when a provider is unavailable.
- Supports task-aware routing: fast conversational replies can prefer Groq;
  code/structured tasks can prefer Gemini.
- Optional streaming via on_delta(text_chunk) for providers that support it.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

try:
    from groq import Groq  # type: ignore
except Exception:  # pragma: no cover
    Groq = None  # type: ignore


def _retryable(exc: Exception) -> bool:
    msg = f"{type(exc).__name__} {exc}".lower()
    status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
    try:
        if status is not None and int(status) in {408, 409, 429, 500, 502, 503, 504}:
            return True
    except Exception:
        pass
    needles = (
        "429", "rate limit", "rate_limit", "too many requests", "quota",
        "resource_exhausted", "resource exhausted", "timeout", "timed out",
        "temporarily unavailable", "service unavailable", "overloaded",
        "connection", "503", "502", "504",
    )
    return any(n in msg for n in needles)


def _contents_to_groq_messages(contents: Any, system_instruction: str | None) -> list[dict]:
    messages: list[dict] = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    if isinstance(contents, str):
        messages.append({"role": "user", "content": contents})
        return messages
    if isinstance(contents, list):
        for item in contents:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "user")
            if role == "model":
                role = "assistant"
            parts = item.get("parts")
            text = ""
            if isinstance(parts, list):
                text = "\n".join(
                    str(p.get("text") or "")
                    for p in parts
                    if isinstance(p, dict) and p.get("text") is not None
                )
            elif isinstance(item.get("text"), str):
                text = item["text"]
            elif isinstance(item.get("content"), str):
                text = item["content"]
            if text.strip():
                messages.append({"role": role, "content": text})
    if not messages or messages[-1]["role"] == "system":
        messages.append({"role": "user", "content": ""})
    return messages


def _gemini_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    try:
        candidates = getattr(response, "candidates", None) or []
        for c in candidates:
            content = getattr(c, "content", None)
            parts = getattr(content, "parts", None) or []
            out = [str(getattr(p, "text", "")) for p in parts if getattr(p, "text", None)]
            if out:
                return "\n".join(out).strip()
    except Exception:
        pass
    return ""


class LLMFallbackProvider:
    def __init__(self, gemini_client: Any = None) -> None:
        self.gemini_client = gemini_client
        self._groq_client = None

    def _groq(self):
        if self._groq_client is not None:
            return self._groq_client
        key = os.getenv("GROQ_API_KEY")
        if not key or Groq is None:
            return None
        self._groq_client = Groq(api_key=key)
        return self._groq_client

    def _order_for(self, task: str, prefer_fast: bool) -> list[str]:
        primary = (os.getenv("LLM_PRIMARY") or "gemini").strip().lower()
        fallback = (os.getenv("LLM_FALLBACK") or "groq").strip().lower()
        groq_ok = bool(os.getenv("GROQ_API_KEY")) and Groq is not None
        fast_groq = (os.getenv("LLM_FAST_REPLY_PROVIDER") or "groq").strip().lower()
        if prefer_fast and task in {"reply", "chat"} and fast_groq == "groq" and groq_ok:
            order = ["groq", primary if primary != "groq" else fallback]
        else:
            order = [primary, fallback]
        out: list[str] = []
        for p in order:
            if p in {"gemini", "groq"} and p not in out:
                out.append(p)
        return out or ["gemini", "groq"]

    def generate_text(
        self,
        *,
        contents: Any,
        system_instruction: str | None = None,
        gemini_model: str | None = None,
        groq_model: str | None = None,
        task: str = "general",
        prefer_fast: bool = False,
        on_delta: Callable[[str], None] | None = None,
    ) -> tuple[str, str, dict]:
        """Return (text, provider, meta). Tries providers in task-aware order."""
        started = time.perf_counter()
        order = self._order_for(task, prefer_fast)
        last_exc: Exception | None = None
        for idx, provider in enumerate(order):
            try:
                if provider == "gemini":
                    model = gemini_model or os.getenv("GEMINI_MODEL") or "gemini-3.1-flash-lite"
                    text, used = self._generate_gemini(
                        contents=contents, system_instruction=system_instruction, model=model, on_delta=on_delta
                    )
                elif provider == "groq":
                    model = groq_model or (
                        os.getenv("GROQ_FAST_MODEL") if prefer_fast and task in {"reply", "chat"} else None
                    ) or os.getenv("GROQ_MODEL") or "llama-3.3-70b-versatile"
                    text, used = self._generate_groq(
                        contents=contents, system_instruction=system_instruction, model=model, on_delta=on_delta
                    )
                else:
                    continue
                meta = {"provider": used, "model": model, "llm_ms": int((time.perf_counter() - started) * 1000), "task": task}
                return text, used, meta
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                has_next = idx < len(order) - 1
                msg = str(exc).lower()
                unavailable = "not configured" in msg or "no llm provider" in msg
                if has_next and (_retryable(exc) or unavailable):
                    logger.warning("LLM provider %s unavailable/retryable, falling back: %s", provider, type(exc).__name__)
                    continue
                raise
        if last_exc:
            raise last_exc
        raise RuntimeError("No LLM provider available")

    def _generate_gemini(self, *, contents: Any, system_instruction: str | None, model: str, on_delta=None) -> tuple[str, str]:
        if self.gemini_client is None or not os.getenv("GEMINI_API_KEY"):
            raise RuntimeError("Gemini is not configured")
        kwargs: dict[str, Any] = {"model": model, "contents": contents}
        if system_instruction:
            kwargs["config"] = {"system_instruction": system_instruction}
        response = self.gemini_client.models.generate_content(**kwargs)
        text = _gemini_text(response)
        if on_delta and text:
            on_delta(text)
        return text, "gemini"

    def _generate_groq(self, *, contents: Any, system_instruction: str | None, model: str, on_delta=None) -> tuple[str, str]:
        client = self._groq()
        if client is None:
            raise RuntimeError("Groq is not configured (set GROQ_API_KEY and install groq)")
        messages = _contents_to_groq_messages(contents, system_instruction)
        if on_delta:
            stream = client.chat.completions.create(model=model, messages=messages, temperature=0.2, stream=True)
            parts: list[str] = []
            for chunk in stream:
                try:
                    delta = chunk.choices[0].delta
                    piece = getattr(delta, "content", None) or ""
                except Exception:
                    piece = ""
                if piece:
                    parts.append(piece)
                    try:
                        on_delta(piece)
                    except Exception:
                        pass
            return "".join(parts).strip(), "groq"
        resp = client.chat.completions.create(model=model, messages=messages, temperature=0.2)
        text = ""
        try:
            choice = (resp.choices or [None])[0]
            msg = getattr(choice, "message", None)
            content = getattr(msg, "content", None)
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                text = "\n".join(str(x.get("text", x) if isinstance(x, dict) else x) for x in content)
        except Exception:
            text = ""
        return (text or "").strip(), "groq"
