"""Write-file tool: create or overwrite a file in the workspace."""

from __future__ import annotations

import os
from pathlib import Path

from ..pipeline.errors import ToolExecutionError

WORKSPACE_ROOT = Path(os.getenv("LEO_WORKSPACE_ROOT", ".")).resolve()


def write_file(path: str, code: str, workspace: Path | None = None) -> str:
    """Write ``code`` to ``path`` relative to the workspace.

    Returns the absolute path of the written file.
    """
    if workspace is None:
        workspace = WORKSPACE_ROOT
    root = workspace.resolve()
    resolved = (root / path).resolve()

    # Prevent escaping the sandbox.
    if not str(resolved).startswith(str(root)):
        raise ToolExecutionError("Path escapes the workspace")

    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(code, encoding="utf-8")
    return str(resolved)


__all__ = ["write_file"]
