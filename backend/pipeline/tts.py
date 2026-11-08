"""Gnani Prisma text-to-speech client.

Wraps the Gnani TTS HTTP API so the controller only talks to this module.
Returns raw audio bytes; the WebSocket controller decides how to hand them
to the browser (byte-fragmented encodeURIComponent payload inside JSON).
"""

from __future__ import annotations

import os
import requests

GNANI_TTS_URL = os.getenv("GNANI_TTS_URL", "https://api.vachana.ai/tts/v3")
GNANI_API_KEY = os.getenv("GNANI_API_KEY")


class GnaniTTSError(Exception):
    """Gnani TTS service returned an error."""


class GnaniTTSClient:
    """Thin client around the Gnani TTS HTTP API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = GNANI_TTS_URL,
        voice: str = "aura-aria",
    ) -> None:
        self.api_key = api_key or GNANI_API_KEY
        self.base_url = base_url.rstrip("/")
        self.voice = voice

        if not self.api_key:
            raise GnaniTTSError("GNANI_API_KEY is not configured")

    def synthesize(
        self,
        text: str,
        *,
        voice: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        """Return raw audio bytes for ``text``.

        Args:
            text: The text to synthesise.
            voice: Optional voice override (defaults to the client voice).
            speed: Speech rate multiplier.

        Returns:
            Raw audio file bytes.

        Raises:
            GnaniTTSError: If the Gnani TTS API rejects the request.
        """
        if not self.api_key:
            raise GnaniTTSError("GNANI_API_KEY is not configured")

        payload = {
            "text": text,
            "voice": voice or self.voice,
            "speed": speed,
            "response_format": "mp3",
        }

        headers = {"X-API-Key-ID": self.api_key}
        response = requests.post(
            self.base_url,
            json=payload,
            headers=headers,
            timeout=60,
        )

        if response.status_code != 200:
            detail = response.text or f"Gnani TTS returned HTTP {response.status_code}"
            raise GnaniTTSError(detail)

        payload_body = response.json()
        if not isinstance(payload_body, dict) or "audio" not in payload_body:
            detail = (
                payload_body.get("error")
                or payload_body.get("message")
                or "Unexpected Gnani TTS response"
            )
            raise GnaniTTSError(detail)

        audio = payload_body["audio"]
        if isinstance(audio, dict) and "b64" in audio and "ext" in audio:
            # The API may return base64 audio + file extension.
            import base64

            return base64.b64decode(audio["b64"])

        if isinstance(audio, str):
            # Some Gnani TTS endpoints return a bare base64 payload.
            import base64

            return base64.b64decode(audio)

        # Fall back to raw bytes if the payload is already bytes-like.
        if hasattr(audio, "read"):
            return audio.read()

        raise GnaniTTSError("Unsupported Gnani TTS audio payload format")
