"""Synchronous data access for the Leo backend.

Async routes call these helpers through ``asyncio.to_thread``. Functions
return plain dicts so callers never hold a detached ORM instance.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, func, select

from db import session_scope
from models import EditRevision, FileSnapshot, User, VoiceTurn, Workspace


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


def get_or_create_user(email: str) -> dict:
    """Return the user for `email`, creating it on first sign-in."""
    normalized = email.strip().lower()
    with session_scope() as session:
        user = session.scalar(select(User).where(func.lower(User.email) == normalized))
        if user is None:
            user = User(email=normalized)
            session.add(user)
            session.flush()
        return {"id": user.id, "email": user.email, "created_at": _iso(user.created_at)}


def get_user(user_id: int) -> dict | None:
    with session_scope() as session:
        user = session.get(User, user_id)
        if user is None:
            return None
        return {"id": user.id, "email": user.email, "created_at": _iso(user.created_at)}


def get_user_by_email(email: str) -> dict | None:
    normalized = email.strip().lower()
    with session_scope() as session:
        user = session.scalar(select(User).where(func.lower(User.email) == normalized))
        if user is None:
            return None
        return {"id": user.id, "email": user.email, "created_at": _iso(user.created_at)}


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------


def get_or_create_workspace(user_id: int, name: str = "default") -> int:
    """Return the id of the user's workspace, creating it if needed."""
    with session_scope() as session:
        workspace = session.scalar(
            select(Workspace).where(
                Workspace.user_id == user_id, Workspace.name == name
            )
        )
        if workspace is None:
            workspace = Workspace(user_id=user_id, name=name)
            session.add(workspace)
            session.flush()
        return workspace.id


def get_workspace(workspace_id: int) -> dict | None:
    with session_scope() as session:
        workspace = session.get(Workspace, workspace_id)
        if workspace is None:
            return None
        return {
            "id": workspace.id,
            "user_id": workspace.user_id,
            "name": workspace.name,
            "created_at": _iso(workspace.created_at),
        }


# ---------------------------------------------------------------------------
# File snapshots
# ---------------------------------------------------------------------------


def save_file_snapshot(workspace_id: int, path: str, content: str) -> None:
    """Insert or update the stored content for one workspace file."""
    with session_scope() as session:
        snapshot = session.scalar(
            select(FileSnapshot).where(
                FileSnapshot.workspace_id == workspace_id, FileSnapshot.path == path
            )
        )
        if snapshot is None:
            session.add(
                FileSnapshot(workspace_id=workspace_id, path=path, content=content)
            )
        else:
            snapshot.content = content


def delete_file_snapshot(workspace_id: int, path: str) -> None:
    with session_scope() as session:
        session.execute(
            delete(FileSnapshot).where(
                FileSnapshot.workspace_id == workspace_id, FileSnapshot.path == path
            )
        )


def list_file_snapshots(workspace_id: int) -> list[dict]:
    with session_scope() as session:
        rows = session.scalars(
            select(FileSnapshot)
            .where(FileSnapshot.workspace_id == workspace_id)
            .order_by(FileSnapshot.path)
        ).all()
        return [
            {
                "path": row.path,
                "content": row.content,
                "updated_at": _iso(row.updated_at),
            }
            for row in rows
        ]


# ---------------------------------------------------------------------------
# Edit revisions (undo / per-file history)
# ---------------------------------------------------------------------------


def record_edit_revision(
    workspace_id: int, path: str, before_content: str, after_content: str, summary: str = ""
) -> dict:
    """Store one applied edit so it can be undone later."""
    with session_scope() as session:
        revision = EditRevision(
            workspace_id=workspace_id,
            path=path,
            before_content=before_content,
            after_content=after_content,
            summary=summary,
        )
        session.add(revision)
        session.flush()
        return {
            "id": revision.id,
            "path": revision.path,
            "summary": revision.summary,
            "created_at": _iso(revision.created_at),
        }


def list_edit_revisions(
    workspace_id: int, path: str | None = None, limit: int = 25
) -> list[dict]:
    """Return recent revisions for a workspace, newest first."""
    with session_scope() as session:
        query = select(EditRevision).where(
            EditRevision.workspace_id == workspace_id
        )
        if path:
            query = query.where(EditRevision.path == path)
        revisions = session.scalars(
            query.order_by(
                EditRevision.created_at.desc(), EditRevision.id.desc()
            ).limit(limit)
        ).all()
        return [
            {
                "id": revision.id,
                "path": revision.path,
                "before_content": revision.before_content,
                "after_content": revision.after_content,
                "summary": revision.summary,
                "created_at": _iso(revision.created_at),
                "undone_at": _iso(revision.undone_at),
            }
            for revision in revisions
        ]


def get_edit_revision(workspace_id: int, revision_id: int) -> dict | None:
    """Return one revision scoped to its owning workspace."""
    with session_scope() as session:
        revision = session.scalar(
            select(EditRevision).where(
                EditRevision.id == revision_id,
                EditRevision.workspace_id == workspace_id,
            )
        )
        if revision is None:
            return None
        return {
            "id": revision.id,
            "path": revision.path,
            "before_content": revision.before_content,
            "after_content": revision.after_content,
            "summary": revision.summary,
            "created_at": _iso(revision.created_at),
            "undone_at": _iso(revision.undone_at),
        }


def latest_edit_revision(workspace_id: int, path: str | None = None) -> dict | None:
    """Return the newest revision that has not been undone yet."""
    with session_scope() as session:
        query = select(EditRevision).where(
            EditRevision.workspace_id == workspace_id,
            EditRevision.undone_at.is_(None),
        )
        if path:
            query = query.where(EditRevision.path == path)
        revision = session.scalar(
            query.order_by(EditRevision.created_at.desc(), EditRevision.id.desc())
        )
        if revision is None:
            return None
        return {
            "id": revision.id,
            "path": revision.path,
            "before_content": revision.before_content,
            "after_content": revision.after_content,
            "summary": revision.summary,
            "created_at": _iso(revision.created_at),
        }


def mark_edit_revision_undone(revision_id: int) -> None:
    """Mark a revision as consumed so the next undo walks further back."""
    with session_scope() as session:
        revision = session.get(EditRevision, revision_id)
        if revision is not None:
            revision.undone_at = datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Voice history
# ---------------------------------------------------------------------------


def record_voice_turn(workspace_id: int, transcript: str, reply: str) -> dict:
    with session_scope() as session:
        turn = VoiceTurn(workspace_id=workspace_id, transcript=transcript, reply=reply)
        session.add(turn)
        session.flush()
        return {
            "id": turn.id,
            "transcript": turn.transcript,
            "reply": turn.reply,
            "created_at": _iso(turn.created_at),
        }


def list_voice_turns(workspace_id: int, limit: int = 50) -> list[dict]:
    with session_scope() as session:
        rows = session.scalars(
            select(VoiceTurn)
            .where(VoiceTurn.workspace_id == workspace_id)
            .order_by(VoiceTurn.created_at.desc(), VoiceTurn.id.desc())
            .limit(limit)
        ).all()
        return [
            {
                "id": row.id,
                "transcript": row.transcript,
                "reply": row.reply,
                "created_at": _iso(row.created_at),
            }
            for row in rows
        ]
