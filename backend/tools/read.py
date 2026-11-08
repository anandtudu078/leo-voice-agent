"""Read-file tool: print the contents of a file in the workspace."""

from __future__ import annotations

import os
from pathlib import Path

from pipeline.errors import ToolExecutionError

WORKSPACE_ROOT = Path(os.getenv("LEO_WORKSPACE_ROOT", ".")).resolve()


def read_file(path: str, workspace: Path | None = None) -> str:
    """Read and return the text content of ``path`` relative to the workspace."""
    if workspace is None:
        workspace = WORKSPACE_ROOT
    root = workspace.resolve()
    resolved = (root / path).resolve()

    # Prevent escaping the sandbox.
    if resolved != root and root not in resolved.parents:
        raise ToolExecutionError("Path escapes the workspace")

    if not resolved.is_file():
        raise ToolExecutionError(f"File not found: {path}")

    return resolved.read_text(encoding="utf-8")


__all__ = ["read_file"]
