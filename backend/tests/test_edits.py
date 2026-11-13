"""Tests for reviewable edits: diffing, stale-write safety, and undo."""

import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import edits
import main
import repository
from db import init_db
from sandbox import SandboxExecutor

# Register the models and create the revision table for a fresh test database.
init_db()


def unique_email() -> str:
    return f"edits-{uuid.uuid4().hex}@example.com"


class FakeProvider:
    """Minimal stand-in for LLMFallbackProvider.generate_text."""

    def __init__(self, content: str | None = None, summary: str = "Updated the file"):
        self.content = content
        self.summary = summary

    def generate_text(self, **_kwargs):
        payload = {"summary": self.summary, "content": self.content}
        return json.dumps(payload), "fake", {"provider": "fake"}


class EditTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.executor = SandboxExecutor(root=Path(self.tmp.name))
        self.workspace = self.executor.workspace("edits-test")
        user = repository.get_or_create_user(unique_email())
        self.workspace_id = repository.get_or_create_workspace(user["id"])
        self.path = "app.py"
        self.before = "print('hi')\n"
        self.after = "print('hello')\n"
        self.executor.write(self.workspace, self.path, self.before)

    def tearDown(self):
        self.tmp.cleanup()


class TestDiffing(unittest.TestCase):
    def test_unified_diff_marks_both_versions(self):
        diff = edits.unified_diff("app.py", "x = 1\n", "x = 2\n")
        self.assertIn("--- a/app.py", diff)
        self.assertIn("+++ b/app.py", diff)
        self.assertIn("-x = 1", diff)
        self.assertIn("+x = 2", diff)

    def test_identical_files_have_no_diff(self):
        self.assertEqual(edits.unified_diff("app.py", "x = 1\n", "x = 1\n"), "")

    def test_stats_count_added_and_removed_lines(self):
        added, removed = edits.diff_stats("a\nb\nc\n", "a\nB\nc\nd\n")
        self.assertEqual((added, removed), (2, 1))

    def test_proposal_preserves_crlf_style(self):
        proposal = edits.build_proposal(
            "app.py", "x = 1\r\ny = 2\r\n", "x = 3\ny = 2\n"
        )
        self.assertEqual(proposal["new_code"], "x = 3\r\ny = 2\r\n")
        self.assertTrue(proposal["changed"])


class TestProposeEdit(EditTestCase):
    def test_proposal_parses_json_and_builds_diff(self):
        provider = FakeProvider(self.after)
        proposal = edits.propose_edit(
            provider=provider,
            model=None,
            path=self.path,
            transcript="change the greeting",
            current_code=self.before,
        )
        self.assertTrue(proposal["changed"])
        self.assertEqual(proposal["new_code"], self.after)
        self.assertEqual(proposal["provider"], "fake")
        self.assertEqual((proposal["added"], proposal["removed"]), (1, 1))
        self.assertIn("+print('hello')", proposal["diff"])
        # The on-disk file must not change during proposal generation.
        self.assertEqual(self.executor.read(self.workspace, self.path), self.before)

    def test_proposal_reports_no_change(self):
        proposal = edits.propose_edit(
            provider=FakeProvider(self.before),
            model=None,
            path=self.path,
            transcript="keep it the same",
            current_code=self.before,
        )
        self.assertFalse(proposal["changed"])
        self.assertEqual(proposal["diff"], "")

    def test_oversized_file_is_rejected_before_calling_the_model(self):
        class ExplodingProvider:
            def generate_text(self, **_kwargs):
                raise AssertionError("provider should not be called")

        with self.assertRaises(edits.EditError):
            edits.propose_edit(
                provider=ExplodingProvider(),
                model=None,
                path=self.path,
                transcript="edit it",
                current_code="x" * (edits.MAX_EDIT_CHARS + 1),
            )


class TestApplyAndUndo(EditTestCase):
    def test_apply_writes_and_undo_restores(self):
        result = edits.apply_edit(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=self.workspace_id,
            path=self.path,
            old_code=self.before,
            new_code=self.after,
            summary="Greeting update",
        )
        self.assertTrue(result["changed"])
        self.assertTrue(result["undo_available"])
        self.assertEqual(self.executor.read(self.workspace, self.path), self.after)

        restored = edits.undo_last_edit(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=self.workspace_id,
            path=self.path,
        )
        self.assertEqual(restored["content"], self.before)
        self.assertEqual(self.executor.read(self.workspace, self.path), self.before)

        with self.assertRaises(edits.NothingToUndo):
            edits.undo_last_edit(
                executor=self.executor,
                workspace=self.workspace,
                workspace_id=self.workspace_id,
                path=self.path,
            )

    def test_apply_rejects_a_stale_base(self):
        with self.assertRaises(edits.StaleEditError):
            edits.apply_edit(
                executor=self.executor,
                workspace=self.workspace,
                workspace_id=self.workspace_id,
                path=self.path,
                old_code="print('stale')\n",
                new_code=self.after,
            )
        self.assertEqual(self.executor.read(self.workspace, self.path), self.before)

    def test_undo_refuses_to_clobber_a_newer_file(self):
        edits.apply_edit(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=self.workspace_id,
            path=self.path,
            old_code=self.before,
            new_code=self.after,
        )
        self.executor.write(self.workspace, self.path, "# manual change\n")

        with self.assertRaises(edits.StaleEditError):
            edits.undo_last_edit(
                executor=self.executor,
                workspace=self.workspace,
                workspace_id=self.workspace_id,
                path=self.path,
            )
        self.assertEqual(
            self.executor.read(self.workspace, self.path), "# manual change\n"
        )

    def test_anonymous_workspace_can_apply_but_not_undo(self):
        result = edits.apply_edit(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=None,
            path=self.path,
            old_code=self.before,
            new_code=self.after,
        )
        self.assertFalse(result["undo_available"])
        self.assertEqual(self.executor.read(self.workspace, self.path), self.after)

        with self.assertRaises(edits.NothingToUndo):
            edits.undo_last_edit(
                executor=self.executor,
                workspace=self.workspace,
                workspace_id=None,
                path=self.path,
            )


class TestEditHistory(EditTestCase):
    def _apply(self, new_code: str, summary: str) -> dict:
        current = self.executor.read(self.workspace, self.path)
        return edits.apply_edit(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=self.workspace_id,
            path=self.path,
            old_code=current,
            new_code=new_code,
            summary=summary,
        )

    def test_history_is_newest_first_with_stats(self):
        mid = "print('mid')\n"
        first = self._apply(mid, "First change")
        second = self._apply(self.after, "Second change")

        history = edits.list_edit_history(
            workspace_id=self.workspace_id, path=self.path
        )
        self.assertEqual(
            [entry["id"] for entry in history],
            [second["revision_id"], first["revision_id"]],
        )
        self.assertEqual(
            [entry["summary"] for entry in history],
            ["Second change", "First change"],
        )
        self.assertEqual((history[0]["added"], history[0]["removed"]), (1, 1))
        self.assertIsNone(history[0]["undone_at"])
        self.assertEqual(
            edits.list_edit_history(
                workspace_id=self.workspace_id, path="other.py"
            ),
            [],
        )

    def test_undo_is_reflected_in_history(self):
        self._apply("print('mid')\n", "First change")
        second = self._apply(self.after, "Second change")

        edits.undo_last_edit(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=self.workspace_id,
            path=self.path,
        )
        history = edits.list_edit_history(
            workspace_id=self.workspace_id, path=self.path
        )
        self.assertEqual(history[0]["id"], second["revision_id"])
        self.assertIsNotNone(history[0]["undone_at"])

    def test_restore_preview_targets_the_version_before_a_revision(self):
        mid = "print('mid')\n"
        first = self._apply(mid, "First change")
        self._apply(self.after, "Second change")

        proposal = edits.build_restore_proposal(
            executor=self.executor,
            workspace=self.workspace,
            workspace_id=self.workspace_id,
            revision_id=first["revision_id"],
        )
        self.assertEqual(proposal["old_code"], self.after)
        self.assertEqual(proposal["new_code"], self.before)
        self.assertEqual(proposal["restore_of"], first["revision_id"])
        self.assertTrue(proposal["changed"])
        # Previewing must not write anything.
        self.assertEqual(
            self.executor.read(self.workspace, self.path), self.after
        )

    def test_restore_preview_rejects_an_unknown_revision(self):
        with self.assertRaises(edits.RevisionNotFound):
            edits.build_restore_proposal(
                executor=self.executor,
                workspace=self.workspace,
                workspace_id=self.workspace_id,
                revision_id=2**31 - 1,
            )

    def test_history_is_scoped_to_one_workspace(self):
        self._apply(self.after, "First change")
        other_user = repository.get_or_create_user(unique_email())
        other_workspace = repository.get_or_create_workspace(other_user["id"])
        self.assertEqual(
            edits.list_edit_history(
                workspace_id=other_workspace, path=self.path
            ),
            [],
        )

    def test_anonymous_history_is_empty(self):
        self.assertEqual(edits.list_edit_history(workspace_id=None), [])


class TestEditEndpoints(unittest.TestCase):
    """Exercise the HTTP review loop with a signed-in test client."""

    def setUp(self):
        self.client = TestClient(main.app)
        signin = self.client.post(
            "/api/auth/signin",
            json={"email": unique_email(), "password": "password"},
        )
        self.assertEqual(signin.status_code, 200)
        self.user_id = signin.json()["user"]["id"]
        self.path = f"endpoint-{uuid.uuid4().hex}.py"
        self.before = "value = 1\n"
        self.after = "value = 2\n"
        write = self.client.post(
            "/api/files/write", json={"path": self.path, "code": self.before}
        )
        self.assertEqual(write.status_code, 200)

    def tearDown(self):
        try:
            main.workspace_executor.remove(
                main._workspace_for(self.user_id), self.path
            )
        except Exception:
            pass

    def test_history_and_restore_endpoints(self):
        proposal = edits.build_proposal(
            self.path, self.before, self.after, "Bump the value"
        )
        applied = self.client.post(
            "/api/agent/apply-edit",
            json={
                "path": self.path,
                "old_code": proposal["old_code"],
                "new_code": proposal["new_code"],
                "summary": proposal["summary"],
            },
        )
        self.assertEqual(applied.status_code, 200)

        history = self.client.get(
            "/api/agent/history", params={"path": self.path}
        )
        self.assertEqual(history.status_code, 200)
        body = history.json()
        self.assertTrue(body["signed_in"])
        self.assertEqual(len(body["revisions"]), 1)
        self.assertEqual(body["revisions"][0]["summary"], "Bump the value")

        preview = self.client.post(
            "/api/agent/restore-preview",
            json={"revision_id": body["revisions"][0]["id"]},
        )
        self.assertEqual(preview.status_code, 200)
        preview_body = preview.json()
        self.assertEqual(preview_body["old_code"], self.after)
        self.assertEqual(preview_body["new_code"], self.before)

        restored = self.client.post(
            "/api/agent/apply-edit",
            json={
                "path": self.path,
                "old_code": preview_body["old_code"],
                "new_code": preview_body["new_code"],
                "summary": preview_body["summary"],
            },
        )
        self.assertEqual(restored.status_code, 200)
        read = self.client.get("/api/files/read", params={"path": self.path})
        self.assertEqual(read.json()["content"], self.before)

        history = self.client.get(
            "/api/agent/history", params={"path": self.path}
        ).json()
        self.assertEqual(len(history["revisions"]), 2)
        self.assertTrue(
            history["revisions"][0]["summary"].startswith(
                "Restore the version before"
            )
        )

    def test_restore_preview_returns_404_for_unknown_revision(self):
        response = self.client.post(
            "/api/agent/restore-preview", json={"revision_id": 2**31 - 1}
        )
        self.assertEqual(response.status_code, 404)

    def test_propose_apply_and_undo_round_trip(self):
        proposal = edits.build_proposal(
            self.path, self.before, self.after, "Bump the value"
        )
        with patch("main.propose_edit", return_value=proposal) as mocked:
            response = self.client.post(
                "/api/agent/propose-edit",
                json={"path": self.path, "transcript": "change the value to 2"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["diff"], proposal["diff"])
        mocked.assert_called_once()
        # Proposing must not write to disk.
        read = self.client.get("/api/files/read", params={"path": self.path})
        self.assertEqual(read.json()["content"], self.before)

        applied = self.client.post(
            "/api/agent/apply-edit",
            json={
                "path": self.path,
                "old_code": self.before,
                "new_code": self.after,
                "summary": "Bump the value",
            },
        )
        self.assertEqual(applied.status_code, 200)
        self.assertTrue(applied.json()["undo_available"])
        read = self.client.get("/api/files/read", params={"path": self.path})
        self.assertEqual(read.json()["content"], self.after)

        stale = self.client.post(
            "/api/agent/apply-edit",
            json={
                "path": self.path,
                "old_code": self.before,
                "new_code": "value = 3\n",
            },
        )
        self.assertEqual(stale.status_code, 409)

        undone = self.client.post(
            "/api/agent/undo", json={"path": self.path}
        )
        self.assertEqual(undone.status_code, 200)
        self.assertEqual(undone.json()["content"], self.before)
        read = self.client.get("/api/files/read", params={"path": self.path})
        self.assertEqual(read.json()["content"], self.before)

        empty = self.client.post("/api/agent/undo", json={"path": self.path})
        self.assertEqual(empty.status_code, 409)


if __name__ == "__main__":
    unittest.main()
