"""Workspace sandbox for executing user-generated code safely.

The sandbox runs in an isolated working directory and exposes a small set
of tools (read, write, run scripts) so the orchestrator can produce and
execute code without touching the host filesystem.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

from pipeline.errors import SandboxError, ToolExecutionError

SANDBOX_ROOT = Path(tempfile.gettempdir()) / "leo-sandbox"
SANDBOX_ROOT.mkdir(parents=True, exist_ok=True)


class SandboxExecutionError(SandboxError):
    """The sandbox rejected the execution request."""


class SandboxExecutor:
    """Create isolated workspaces and execute a limited set of tools."""

    def __init__(self, root: Path = SANDBOX_ROOT) -> None:
        self.root = root.resolve()

    def workspace(self, label: str = "workspace") -> Path:
        """Create (or reuse) an isolated workspace directory."""
        workspace = self.root / label
        workspace.mkdir(parents=True, exist_ok=True)
        return workspace

    def _resolve(self, workspace: Path, path: str | Path) -> Path:
        """Resolve ``path`` inside ``workspace``, rejecting escapes."""
        root = workspace.resolve()
        resolved = (root / path).resolve()
        if resolved != root and root not in resolved.parents:
            raise SandboxExecutionError("Path escapes the workspace")
        return resolved

    def read(self, workspace: Path, path: str) -> str:
        """Read a file relative to the workspace. Returns its text content."""
        resolved = self._resolve(workspace, path)
        if not resolved.is_file():
            raise SandboxExecutionError(f"File not found: {path}")
        return resolved.read_text(encoding="utf-8")

    def write(self, workspace: Path, path: str, code: str) -> str:
        """Write code to a file inside the workspace and return its path."""
        resolved = self._resolve(workspace, path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(code, encoding="utf-8")
        return str(resolved)

    def remove(self, workspace: Path, path: str) -> None:
        """Delete a file or directory inside the workspace."""
        import shutil

        resolved = self._resolve(workspace, path)
        if resolved.is_dir():
            shutil.rmtree(resolved)
        elif resolved.is_file():
            resolved.unlink()

    def make_dir(self, workspace: Path, path: str) -> str:
        """Create a directory inside the workspace and return its path."""
        resolved = self._resolve(workspace, path)
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved)

    def rename(self, workspace: Path, path: str, new_path: str) -> str:
        """Move a file or directory inside the workspace."""
        source = self._resolve(workspace, path)
        target = self._resolve(workspace, new_path)
        if not source.exists():
            raise SandboxExecutionError(f"Path not found: {path}")
        if target.exists():
            raise SandboxExecutionError(f"Path already exists: {new_path}")
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)
        return str(target)

    def run(self, workspace: Path, script_path: str, args: list[str] | None = None) -> str:
        """Execute a script within the workspace in a fresh subprocess.

        Only ``python`` / ``node`` scripts may be executed; binary/file
        removal and shell concatenation are deliberately blocked.
        """
        resolved = self._resolve(workspace, script_path)
        if not resolved.is_file():
            raise SandboxExecutionError(f"File not found: {script_path}")

        # Only trusted interpreters are allowed; block shell pipelines and
        # arbitrary binary execution.
        if resolved.suffix == ".py":
            executable = sys.executable
        elif resolved.suffix in {".js", ".mjs"}:
            executable = os.environ.get("NODE_BINARY") or "node"
        else:
            raise SandboxExecutionError("Only .py/.js/.mjs scripts may be run")

        args = args or []

        try:
            result = subprocess.run(
                [executable, str(resolved)] + args,
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise SandboxExecutionError("Script timed out after 30s")
        except OSError as exc:
            raise SandboxExecutionError(f"Could not execute script: {exc}") from exc

        output = result.stdout or ""
        if result.returncode != 0:
            output += (result.stderr or "") + f"\n[exit code {result.returncode}]"
            raise SandboxExecutionError(output)

        return output
