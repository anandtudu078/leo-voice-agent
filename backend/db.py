"""Database setup for the Leo backend.

Postgres in production, SQLite locally. Set ``DATABASE_URL`` to a Postgres
connection string (Neon, Render, Fly, or any managed Postgres) and the same
code runs unchanged; with no URL configured the backend falls back to
``.data/leo.db`` so a clone is runnable without external services.

The engine is synchronous. Async routes call the repository through
``asyncio.to_thread`` so a slow database round-trip never blocks the event
loop that is also streaming audio.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DEFAULT_SQLITE_PATH = Path(__file__).resolve().parent.parent / ".data" / "leo.db"


def _database_url() -> str:
    """Return the configured database URL, defaulting to a local SQLite file."""
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url:
        # Managed providers still hand out the legacy ``postgres://`` scheme,
        # which SQLAlchemy 2 rejects. Point both flavours at psycopg (v3).
        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://") :]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        return url

    DEFAULT_SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{DEFAULT_SQLITE_PATH.as_posix()}"


def _create_engine():
    url = _database_url()
    options: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        # Repository calls run in worker threads, so the connection must not
        # be bound to the thread that created it.
        options["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **options)


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model."""


def init_db() -> None:
    """Create missing tables. Safe to call on every process start."""
    import models  # noqa: F401  (registers the models on Base.metadata)

    Base.metadata.create_all(engine)


def ping_database() -> bool:
    """Return True when the configured database answers a trivial query."""
    from sqlalchemy import text

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 - a health probe must never raise
        return False


@contextmanager
def session_scope() -> Iterator[Session]:
    """Open a session, commit on success, and always close it."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
