"""Context-aware, reviewable edits for the Leo workspace.

The agent proposes a complete updated file, the controller turns it into a
unified diff, and the client must accept it before anything is written. Every
applied edit records a revision so it can be undone without another LLM call.

This module is deliberately synchronous: FastAPI routes and the voice socket
call it through ``asyncio.to_thread``.
"""

from __future__ import annotations

import difflib
import json
import logging
import re
from pathlib import Path

import repository
from sandbox import SandboxExecutionError, SandboxExecutor

logger = logging.getLogger(__name__)

# Above this size a full-file rewrite stops being a safe edit strategy: the
# model would have to reproduce too much unrelated code.
MAX_EDIT_CHARS = 24_000
MAX_HISTORY_TURNS = 6
MAX_HISTORY_ENTRIES = 25


class EditError(Exception):
    """The edit could not be proposed or applied."""


class StaleEditError(EditError):
    """The file changed after the proposal was generated."""


class NothingToUndo(EditError):
    """No un-applied revision exists for the requested workspace/file."""


class RevisionNotFound(EditError):
    """The requested revision does not belong to this workspace."""


def _normalize_newlines(value: str, reference: str) -> str:
    """Match the line ending style of the file being edited."""
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    if "\r\n" in reference:
        return normalized.replace("\n", "\r\n")
    return normalized


def unified_diff(path: str, before: str, after: str) -> str:
    """Return a readable unified diff for two versions of a file."""
    diff_lines = list(
        difflib.unified_diff(
            before.splitlines(),
            after.splitlines(),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
        )
    )
    if not diff_lines:
        return ""
    return "\n".join(diff_lines) + "\n"


def diff_stats(before: str, after: str) -> tuple[int, int]:
    """Return (added_lines, removed_lines) between two versions."""
    added = removed = 0
    matcher = difflib.SequenceMatcher(a=before.splitlines(), b=after.splitlines())
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in {"replace", "delete"}:
            removed += i2 - i1
        if tag in {"replace", "insert"}:
            added += j2 - j1
    return added, removed


def build_proposal(path: str, old_code: str, new_code: str, summary: str = "") -> dict:
    """Diff an already-generated file version into a reviewable proposal."""
    new_code = _normalize_newlines(new_code, old_code)
    added, removed = diff_stats(old_code, new_code)
    changed = new_code != old_code
    return {
        "path": path,
        "old_code": old_code,
        "new_code": new_code,
        "diff": unified_diff(path, old_code, new_code) if changed else "",
        "summary": summary or (f"Updated {path}" if changed else f"No changes to {path}"),
        "added": added,
        "removed": removed,
        "changed": changed,
    }


def _strip_fences(text: str) -> str:
    value = text.strip()
    if not value.startswith("```"):
        return value
    value = re.sub(r"^```[^\n]*\n?", "", value)
    value = re.sub(r"\n?```$", "", value)
    return value.strip()


def _parse_model_output(raw: str) -> tuple[str, str]:
    """Return (content, summary) from JSON or a fenced code block."""
    text = (raw or "").strip()
    if not text:
        raise EditError("The model returned an empty edit.")

    fenced = _strip_fences(text)
    candidate = fenced if fenced != text else text

    # Prefer JSON, but fall back to treating the whole output as file content.
    for source in (fenced, text):
        start, end = source.find("{"), source.rfind("}")
        if start == -1 or end <= start:
            continue
        try:
            data = json.loads(source[start : end + 1])
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict):
            content = data.get("content")
            if not isinstance(content, str):
                content = data.get("code")
            if isinstance(content, str):
                summary = data.get("summary")
                return content, str(summary or "").strip()

    return candidate, ""


def _prompt(
    *, path: str, transcript: str, current_code: str, history: list[dict], selection: str
) -> str:
    turns = []
    for turn in list(history or [])[-MAX_HISTORY_TURNS:]:
        text = str(turn.get("text") or "").strip()
        if text:
            turns.append(f"{turn.get('role', 'user')}: {text[:600]}")
    conversation = "\n".join(turns) or "(no earlier turns)"
    selected = f"\nSelected text:\n{selection[:2000]}\n" if selection.strip() else ""

    return (
        "You are Leo, a precise coding editor inside an IDE. "
        "Edit the target file to satisfy the user's request. "
        "Return ONLY valid JSON with this exact shape:\n"
        '{"summary": "one short sentence describing the change", '
        '"content": "the complete updated file contents"}\n'
        "Rules:\n"
        "- Preserve all unrelated code, formatting, imports, and comments exactly.\n"
        "- Return the complete file, not a patch and not a snippet.\n"
        "- Do not wrap the JSON in markdown fences.\n"
        "- If the request is ambiguous or impossible, return the current content "
        "unchanged and explain why in summary.\n"
        f"\nTarget path: {path}\n"
        f"User request: {transcript}\n"
        f"Recent conversation:\n{conversation}\n"
        f"{selected}"
        f"\nCurrent file contents:\n{current_code}"
    )


def propose_edit(
    *,
    provider,
    model: str | None,
    path: str,
    transcript: str,
    current_code: str,
    history: list[dict] | None = None,
    selection: str = "",
) -> dict:
    """Ask the LLM for an updated file and turn it into a reviewable diff."""
    if not path.strip():
        raise EditError("A target file is required.")
    if len(current_code) > MAX_EDIT_CHARS:
        raise EditError(
            f"{path} is too large to edit safely in one pass "
            f"({len(current_code):,} characters). Open a smaller file."
        )

    prompt = _prompt(
        path=path,
        transcript=transcript,
        current_code=current_code,
        history=list(history or []),
        selection=selection,
    )
    try:
        result = provider.generate_text(
            contents=prompt,
            gemini_model=model,
            task="edit",
            prefer_fast=False,
        )
    except Exception as exc:  # noqa: BLE001 - surface a usable message
        logger.warning("edit proposal failed path=%s err=%s", path, type(exc).__name__)
        raise EditError(f"Could not generate an edit: {exc}") from exc

    text = result[0] if isinstance(result, tuple) else str(result)
    meta = result[2] if isinstance(result, tuple) and len(result) > 2 else {}
    content, summary = _parse_model_output(text)
    proposal = build_proposal(path, current_code, content, summary)
    proposal["provider"] = meta.get("provider") or (
        result[1] if isinstance(result, tuple) and len(result) > 1 else "unknown"
    )
    return proposal


def apply_edit(
    *,
    executor: SandboxExecutor,
    workspace: Path,
    workspace_id: int | None,
    path: str,
    old_code: str,
    new_code: str,
    summary: str = "",
) -> dict:
    """Apply a reviewed proposal, but only if the file still matches `old_code`."""
    if not path.strip():
        raise EditError("A target file is required.")

    try:
        current = executor.read(workspace, path)
    except SandboxExecutionError as exc:
        raise EditError(str(exc)) from exc

    if current != old_code:
        raise StaleEditError(
            f"{path} changed after this proposal was created. Review the new version."
        )

    new_code = _normalize_newlines(new_code, current)
    changed = new_code != current
    revision_id: int | None = None
    if changed:
        try:
            executor.write(workspace, path, new_code)
        except SandboxExecutionError as exc:
            raise EditError(str(exc)) from exc

        if workspace_id is not None:
            try:
                revision = repository.record_edit_revision(
                    workspace_id, path, current, new_code, summary
                )
                revision_id = revision["id"]
                repository.save_file_snapshot(workspace_id, path, new_code)
            except Exception as exc:  # noqa: BLE001 - the file is already saved
                logger.warning("could not record edit revision path=%s err=%s", path, exc)

    return {
        "path": path,
        "content": new_code,
        "changed": changed,
        "revision_id": revision_id,
        "undo_available": revision_id is not None,
        "summary": summary,
    }


def list_edit_history(
    *,
    workspace_id: int | None,
    path: str | None = None,
    limit: int = MAX_HISTORY_ENTRIES,
) -> list[dict]:
    """Return compact history entries for a file (or the whole workspace)."""
    if workspace_id is None:
        return []
    entries: list[dict] = []
    for revision in repository.list_edit_revisions(workspace_id, path, limit):
        added, removed = diff_stats(
            revision["before_content"], revision["after_content"]
        )
        entries.append(
            {
                "id": revision["id"],
                "path": revision["path"],
                "summary": revision["summary"]
                or f"Updated {revision['path']}",
                "created_at": revision["created_at"],
                "undone_at": revision["undone_at"],
                "added": added,
                "removed": removed,
            }
        )
    return entries


def build_restore_proposal(
    *,
    executor: SandboxExecutor,
    workspace: Path,
    workspace_id: int | None,
    revision_id: int,
) -> dict:
    """Diff the current file against the state before `revision_id`.

    The returned proposal still goes through the normal review/apply path, so
    restoring an older version is explicit and undoable.
    """
    if workspace_id is None:
        raise EditError("Sign in to restore an earlier version.")

    revision = repository.get_edit_revision(workspace_id, revision_id)
    if revision is None:
        raise RevisionNotFound("That edit is no longer in this workspace's history.")

    try:
        current = executor.read(workspace, revision["path"])
    except SandboxExecutionError as exc:
        raise EditError(str(exc)) from exc

    label = revision["summary"] or "that edit"
    proposal = build_proposal(
        revision["path"],
        current,
        revision["before_content"],
        f"Restore the version before: {label}",
    )
    proposal["restore_of"] = revision["id"]
    if not proposal["changed"]:
        proposal["summary"] = "That version is already the current content."
    return proposal


def undo_last_edit(
    *,
    executor: SandboxExecutor,
    workspace: Path,
    workspace_id: int | None,
    path: str | None = None,
) -> dict:
    """Restore the newest un-undone revision for `path` (or the workspace)."""
    if workspace_id is None:
        raise NothingToUndo("Sign in to use undo history.")

    revision = repository.latest_edit_revision(workspace_id, path)
    if revision is None:
        where = f" for {path}" if path else ""
        raise NothingToUndo(f"Nothing to undo{where}.")

    try:
        current = executor.read(workspace, revision["path"])
    except SandboxExecutionError as exc:
        current = None
        logger.warning("undo target unreadable path=%s err=%s", revision["path"], exc)

    if current is not None and current != revision["after_content"]:
        raise StaleEditError(
            f"{revision['path']} changed after that edit. Save or revert it before undoing."
        )

    try:
        executor.write(workspace, revision["path"], revision["before_content"])
    except SandboxExecutionError as exc:
        raise EditError(str(exc)) from exc

    repository.mark_edit_revision_undone(revision["id"])
    try:
        repository.save_file_snapshot(
            workspace_id, revision["path"], revision["before_content"]
        )
    except Exception:  # noqa: BLE001 - best-effort snapshot
        pass

    return {
        "path": revision["path"],
        "content": revision["before_content"],
        "revision_id": revision["id"],
        "summary": revision["summary"],
    }


__all__ = [
    "EditError",
    "NothingToUndo",
    "RevisionNotFound",
    "StaleEditError",
    "apply_edit",
    "build_proposal",
    "build_restore_proposal",
    "diff_stats",
    "list_edit_history",
    "propose_edit",
    "undo_last_edit",
    "unified_diff",
]
