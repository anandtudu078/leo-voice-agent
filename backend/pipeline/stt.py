"""Gnani Prisma speech-to-text client.

Wraps the Gnani STT API so the controller only talks to this module.
An error-shaped response (missing ``transcript`` key) is raised as a
``GnaniSTTError`` instead of being silently treated as "no speech".
"""

from __future__ import annotations

import os
import requests

from .errors import GnaniSTTError

GNANI_STT_URL = os.getenv("GNANI_STT_URL", "https://api.vachana.ai/stt/v3")
GNANI_API_KEY = os.getenv("GNANI_API_KEY")
DEFAULT_MODEL = os.getenv("GNANI_STT_MODEL", "prisma-v3.0")
DEFAULT_LANGUAGE = os.getenv("GNANI_STT_LANGUAGE", "en-IN")


class GnaniSTTClient:
    """Thin async-friendly wrapper around the Gnani STT HTTP API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = GNANI_STT_URL,
        model: str = DEFAULT_MODEL,
        language: str = DEFAULT_LANGUAGE,
    ) -> None:
        self.api_key = api_key or GNANI_API_KEY
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.language = language

        if not self.api_key:
            raise GnaniSTTError("GNANI_API_KEY is not set")

    def transcribe(self, audio_bytes: bytes, filename: str, content_type: str) -> str:
        """Send raw audio to Gnani and return the transcript string."""
        if not self.api_key:
            raise GnaniSTTError("GNANI_API_KEY is not configured")

        headers = {"X-API-Key-ID": self.api_key}
        files = {"audio_file": (filename, audio_bytes, content_type or "audio/wav")}
        data = {"language_code": self.language, "model": self.model}

        response = requests.post(
            self.base_url,
            headers=headers,
            files=files,
            data=data,
            timeout=60,
        )

        if response.status_code != 200:
            detail = response.text or f"Gnani STT returned HTTP {response.status_code}"
            raise GnaniSTTError(detail)

        payload = response.json()

        # Gnani STT returns the transcript under a "transcript" key.
        if not isinstance(payload, dict) or "transcript" not in payload:
            detail = (
                payload.get("error")
                or payload.get("message")
                or "Unexpected Gnani STT response"
            )
            raise GnaniSTTError(detail)

        transcript = payload["transcript"]

        if not transcript:
            raise GnaniSTTError("No speech detected. Try speaking again.")

        return transcript
