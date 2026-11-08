"""Tests for the Gnani STT client error handling."""

import os
import unittest
from unittest.mock import patch

from pipeline.stt import GnaniSTTClient, GnaniSTTError

# Ensure the test environment has no GNANI_API_KEY before the suite runs.
os.environ.pop("GNANI_API_KEY", None)

# Also clear the cached module-level value in pipeline.stt (it was captured
# when main.py imported it at import time).
pipeline_stt = __import__("pipeline.stt", fromlist=["GNANI_API_KEY"])
pipeline_stt.GNANI_API_KEY = None


class TestGnaniSTTClient(unittest.TestCase):
    def setUp(self):
        self.client = GnaniSTTClient(
            api_key="test-key",
            base_url="https://example.com/stt",
            model="test-model",
            language="en",
        )

    def test_transcribe_success(self):
        with patch("pipeline.stt.requests.post") as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.json.return_value = {"transcript": "hello world"}
            result = self.client.transcribe(b"audio", "voice.wav", "audio/wav")
            self.assertEqual(result, "hello world")

    def test_transcribe_error_status(self):
        with patch("pipeline.stt.requests.post") as mock_post:
            mock_post.return_value.status_code = 500
            mock_post.return_value.text = "server error"
            with self.assertRaises(GnaniSTTError):
                self.client.transcribe(b"audio", "voice.wav", "audio/wav")

    def test_transcribe_no_transcript_key(self):
        with patch("pipeline.stt.requests.post") as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.json.return_value = {"error": "bad request"}
            with self.assertRaises(GnaniSTTError):
                self.client.transcribe(b"audio", "voice.wav", "audio/wav")

    def test_transcribe_no_speech(self):
        with patch("pipeline.stt.requests.post") as mock_post:
            mock_post.return_value.status_code = 200
            mock_post.return_value.json.return_value = {"transcript": ""}
            with self.assertRaises(GnaniSTTError):
                self.client.transcribe(b"audio", "voice.wav", "audio/wav")

    def test_no_api_key(self):
        # The client requires an API key at construction time.
        # When no key is passed, the constructor checks the environment
        # variable and raises GnaniSTTError if it is not set.
        with self.assertRaises(GnaniSTTError):
            GnaniSTTClient(api_key=None)

    def test_api_key_set(self):
        client = GnaniSTTClient(api_key="my-key")
        self.assertEqual(client.api_key, "my-key")
        # base_url defaults to the GNANI_STT_URL environment variable
        self.assertIn("api.vachana.ai", client.base_url)


if __name__ == "__main__":
    unittest.main()
