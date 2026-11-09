"""Gnani Timbre text-to-speech client.

Wraps the Gnani TTS REST API so the controller only talks to this module.
The endpoint returns the synthesised audio as raw bytes (WAV by default),
which the WebSocket controller base64-encodes for the browser.

Docs: https://docs.gnani.ai/api/TTS/tts-inference
"""

from __future__ import annotations

import os

import requests

GNANI_TTS_URL = os.getenv(
    "GNANI_TTS_URL", "https://api.vachana.ai/api/v1/tts/inference"
)
GNANI_API_KEY = os.getenv("GNANI_API_KEY")
DEFAULT_MODEL = os.getenv("GNANI_TTS_MODEL", "timbre-v2.5")
# Voices belong to a model: v2.5 ships Nalini, Kaveri, Deepak, Poorvi; v3.0
# ships Shivani, Avinash, Lakshmi. Kaveri is the English v2.5 voice.
DEFAULT_VOICE = os.getenv("GNANI_TTS_VOICE", "Kaveri")
DEFAULT_LANGUAGE = os.getenv("GNANI_TTS_LANGUAGE", "en-IN")

# 24 kHz keeps the base64 payload small while staying speech-quality.
SAMPLE_RATE = 24000


class GnaniTTSError(Exception):
    """Gnani TTS service returned an error."""


class GnaniTTSClient:
    """Thin client around the Gnani TTS REST API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = GNANI_TTS_URL,
        voice: str = DEFAULT_VOICE,
        model: str = DEFAULT_MODEL,
        language: str = DEFAULT_LANGUAGE,
    ) -> None:
        self.api_key = api_key or GNANI_API_KEY
        self.base_url = base_url.rstrip("/")
        self.voice = voice
        self.model = model
        self.language = language

        if not self.api_key:
            raise GnaniTTSError("GNANI_API_KEY is not configured")

    def synthesize(
        self,
        text: str,
        *,
        voice: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        """Return WAV audio bytes for ``text``.

        Raises:
            GnaniTTSError: If the Gnani TTS API rejects the request.
        """
        if not self.api_key:
            raise GnaniTTSError("GNANI_API_KEY is not configured")
        if not text.strip():
            return b""

        payload = {
            "text": text,
            "voice": voice or self.voice,
            "model": self.model,
            "language": self.language,
            "speed": speed,
            "audio_config": {
                "sample_rate": SAMPLE_RATE,
                "num_channels": 1,
                "sample_width": 2,
                "encoding": "linear_pcm",
                "container": "wav",
            },
        }
        headers = {"X-API-Key-ID": self.api_key}

        try:
            response = requests.post(
                self.base_url,
                json=payload,
                headers=headers,
                timeout=60,
            )
        except requests.RequestException as exc:
            raise GnaniTTSError(f"Gnani TTS request failed: {exc}") from exc

        if response.status_code != 200:
            raise GnaniTTSError(self._error_detail(response))

        content_type = response.headers.get("content-type", "")
        if content_type.startswith("application/json") or response.content[:1] == b"{":
            # A 200 with JSON is an error envelope, not audio.
            raise GnaniTTSError(self._error_detail(response))

        if not response.content:
            raise GnaniTTSError("Gnani TTS returned empty audio")

        return response.content

    @staticmethod
    def _error_detail(response: requests.Response) -> str:
        """Flatten Gnani's error shapes into one readable sentence."""
        try:
            payload = response.json()
        except ValueError:
            return response.text or f"Gnani TTS returned HTTP {response.status_code}"

        if isinstance(payload, dict):
            detail = payload.get("detail")
            if isinstance(detail, dict):
                return str(detail.get("message") or detail.get("error_code") or detail)
            if isinstance(detail, str):
                return detail
            error = payload.get("error")
            if isinstance(error, dict):
                return str(error.get("message") or error)
            if isinstance(error, str):
                return error
            message = payload.get("message")
            if isinstance(message, str):
                return message
        return str(payload) or f"Gnani TTS returned HTTP {response.status_code}"
