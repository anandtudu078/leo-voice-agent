"""Tests for the database layer and the endpoints that read from it.

Every test uses a unique email, so the suite is safe to run against the local
SQLite fallback or against a shared Postgres instance.
"""

import unittest
import uuid

from fastapi.testclient import TestClient

import repository
from db import ping_database
from main import app


def unique_email() -> str:
    return f"test-{uuid.uuid4().hex}@example.com"


class TestDatabaseConnection(unittest.TestCase):
    def test_ping_returns_true(self):
        self.assertTrue(ping_database())

    def test_health_endpoint_reports_database(self):
        response = TestClient(app).get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["database"], "connected")


class TestUsers(unittest.TestCase):
    def test_user_is_created_once(self):
        email = unique_email()
        user = repository.get_or_create_user(email)
        self.assertIsNotNone(user["id"])
        self.assertEqual(user["email"], email)
        self.assertEqual(repository.get_or_create_user(email)["id"], user["id"])

    def test_email_is_case_insensitive(self):
        email = unique_email()
        lower = repository.get_or_create_user(email)
        upper = repository.get_or_create_user(email.upper())
        self.assertEqual(lower["id"], upper["id"])

    def test_lookup_by_id_and_email(self):
        email = unique_email()
        created = repository.get_or_create_user(email)
        self.assertEqual(repository.get_user(created["id"])["email"], email)
        self.assertEqual(repository.get_user_by_email(email)["id"], created["id"])

    def test_unknown_user_returns_none(self):
        self.assertIsNone(repository.get_user(2**31 - 1))
        self.assertIsNone(repository.get_user_by_email(unique_email()))


class TestWorkspaces(unittest.TestCase):
    def test_one_workspace_per_user(self):
        user = repository.get_or_create_user(unique_email())
        first = repository.get_or_create_workspace(user["id"])
        second = repository.get_or_create_workspace(user["id"])
        self.assertEqual(first, second)
        self.assertEqual(repository.get_workspace(first)["user_id"], user["id"])

    def test_unknown_workspace_returns_none(self):
        self.assertIsNone(repository.get_workspace(2**31 - 1))


class TestFileSnapshots(unittest.TestCase):
    def setUp(self):
        user = repository.get_or_create_user(unique_email())
        self.workspace_id = repository.get_or_create_workspace(user["id"])

    def test_save_updates_in_place(self):
        repository.save_file_snapshot(self.workspace_id, "app.py", "print(1)")
        repository.save_file_snapshot(self.workspace_id, "app.py", "print(2)")

        snapshots = repository.list_file_snapshots(self.workspace_id)
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]["path"], "app.py")
        self.assertEqual(snapshots[0]["content"], "print(2)")

    def test_delete_removes_only_that_file(self):
        repository.save_file_snapshot(self.workspace_id, "keep.py", "x = 1")
        repository.save_file_snapshot(self.workspace_id, "gone.py", "y = 2")
        repository.delete_file_snapshot(self.workspace_id, "gone.py")

        paths = [s["path"] for s in repository.list_file_snapshots(self.workspace_id)]
        self.assertEqual(paths, ["keep.py"])

    def test_workspaces_are_isolated(self):
        other = repository.get_or_create_user(unique_email())
        other_workspace = repository.get_or_create_workspace(other["id"])

        repository.save_file_snapshot(self.workspace_id, "mine.py", "a = 1")
        self.assertEqual(repository.list_file_snapshots(other_workspace), [])


class TestVoiceHistory(unittest.TestCase):
    def setUp(self):
        user = repository.get_or_create_user(unique_email())
        self.workspace_id = repository.get_or_create_workspace(user["id"])

    def test_turns_are_returned_newest_first(self):
        repository.record_voice_turn(self.workspace_id, "create app.py", "Done.")
        repository.record_voice_turn(self.workspace_id, "run it", "Ran app.py.")

        turns = repository.list_voice_turns(self.workspace_id)
        self.assertEqual([t["transcript"] for t in turns], ["run it", "create app.py"])
        self.assertEqual(turns[0]["reply"], "Ran app.py.")

    def test_limit_caps_results(self):
        for index in range(3):
            repository.record_voice_turn(self.workspace_id, f"turn {index}", "ok")
        self.assertEqual(len(repository.list_voice_turns(self.workspace_id, limit=2)), 2)

    def test_workspaces_are_isolated(self):
        other = repository.get_or_create_user(unique_email())
        other_workspace = repository.get_or_create_workspace(other["id"])

        repository.record_voice_turn(self.workspace_id, "mine", "ok")
        self.assertEqual(repository.list_voice_turns(other_workspace), [])


class TestHistoryEndpoint(unittest.TestCase):
    def test_history_without_session_is_empty(self):
        response = TestClient(app).get("/api/history")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"turns": []})

    def test_signed_in_user_sees_only_their_turns(self):
        client = TestClient(app)
        signin = client.post("/api/auth/signin", json={"email": unique_email()})
        self.assertEqual(signin.status_code, 200)
        workspace_id = repository.get_or_create_workspace(signin.json()["user"]["id"])
        repository.record_voice_turn(workspace_id, "hello leo", "hi")

        other = repository.get_or_create_user(unique_email())
        other_workspace = repository.get_or_create_workspace(other["id"])
        repository.record_voice_turn(other_workspace, "not yours", "nope")

        turns = client.get("/api/history").json()["turns"]
        self.assertEqual([t["transcript"] for t in turns], ["hello leo"])


if __name__ == "__main__":
    unittest.main()
