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

from ..pipeline.errors import SandboxError, ToolExecutionError

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

    def read(self, workspace: Path, path: str) -> str:
        """Read a file relative to the workspace. Returns its text content."""
        resolved = (workspace / path).resolve()
        if not str(resolved).startswith(str(workspace.resolve())):
            raise SandboxExecutionError("Path escapes the workspace")
        if not resolved.is_file():
            raise SandboxExecutionError(f"File not found: {path}")
        return resolved.read_text(encoding="utf-8")

    def write(self, workspace: Path, path: str, code: str) -> str:
        """Write code to a file inside the workspace and return its path."""
        resolved = (workspace / path).resolve()
        if not str(resolved).startswith(str(workspace.resolve())):
            raise SandboxExecutionError("Path escapes the workspace")
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(code, encoding="utf-8")
        return str(resolved)

    def run(self, workspace: Path, script: str, args: list[str] | None = None) -> str:
        """Execute a script within the workspace in a fresh subprocess.

        Only ``python`` / ``node`` scripts may be executed; binary/file
        removal and shell concatenation are deliberately blocked.
        """
        executable = None
        if script.endswith(".py"):
            executable = sys.executable
        elif script.endswith(".js") or script.endswith(".mjs"):
            executable = os.environ.get("NODE_BINARY") or "node"
        else:
            raise SandboxExecutionError(f"Unsupported script type: {script}")

        filename = os.path.basename(script)
        script_path = workspace / filename

        # Only trusted interpreters are allowed; block shell pipelines and
        # arbitrary binary execution.
        if not script_path.suffix in {".py", ".js", ".mjs"}:
            raise SandboxExecutionError("Only .py/.js/.mjs scripts may be run")

        script_path.write_text(script, encoding="utf-8")
        args = args or []

        try:
            result = subprocess.run(
                [executable, str(script_path)] + args,
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
