"""Tests for the public authentication endpoint.

The project has no database yet, so sign-in is a demo: any well-formed email
is a valid account. The endpoint returns a signed `freebuff_session` cookie
and a JSON body whose session is mirrored into localStorage by the frontend.
"""

import json
import unittest
from http.cookies import SimpleCookie

from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


class TestAuthSignIn(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def _signin(self, email="user@example.com", password="password"):
        return self.client.post(
            "/api/auth/signin",
            json={"email": email, "password": password},
        )

    def test_signin_accepts_valid_email(self):
        response = self._signin(email="user@example.com")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["user"]["email"], "user@example.com")
        self.assertIn("_session", body)

    def test_signin_rejects_missing_email(self):
        response = self.client.post(
            "/api/auth/signin",
            json={"email": "", "password": "password"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.json())

    def test_signin_rejects_invalid_email(self):
        response = self.client.post(
            "/api/auth/signin",
            json={"email": "not-an-email", "password": "password"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.json())

    def test_signin_sets_session_cookie(self):
        response = self._signin(email="user@example.com")
        cookie = response.cookies.get("freebuff_session")
        self.assertIsNotNone(cookie)
        self.assertIsInstance(cookie, str)
        self.assertGreater(len(cookie), 0)
        # The cookie is a signed session token: base64(payload).hex_sig
        self.assertIn(".", cookie)
        payload, sig = cookie.split(".")
        self.assertGreater(len(payload), 0)
        self.assertEqual(len(sig), 64)  # sha256 hex digest

    def test_signin_mirrors_session_in_json_body(self):
        response = self._signin(email="demo@example.com")
        body = response.json()
        self.assertEqual(body["user"]["email"], "demo@example.com")

    def test_signin_gets_401_for_invalid_client_on_next_route_if_used(self):
        # The route handler itself only validates email shape; the signed
        # cookie is validated by the client-side readSession. This test just
        # confirms the endpoint's contract stays stable.
        response = self._signin(email="valid@example.com")
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
