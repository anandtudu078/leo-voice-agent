"""Gnani Evon orchestrator: turn a transcript into a tool-call plan.

The orchestrator is the agent-reasoning layer. Given the transcribed
voice command it asks an LLM to produce a JSON tool-call plan.

This module exposes a pluggable interface so the real Gnani Evon HTTP
API can be swapped in with a single line change. The endpoint contract
is:

    POST https://api.vachana.ai/evon/v1/plan
    {
      "api_key": "...",
      "transcript": "...",
      "tools": [{"name": "...", "description": "..."}],
    }

    {
      "action": "read | write | run | none",
      "tool": "...",
      "args": {...},
      "reason": "...",
      "steps": [{"tool": "...", "path": "...", "code": "...", "args": [...]}],
    }
"""

from __future__ import annotations

import json
import os
import requests

from .errors import OrchestratorError

EVON_URL = os.getenv("EVON_URL", "https://api.vachana.ai/evon/v1")
EVON_API_KEY = os.getenv("EVON_API_KEY", "") or None


def build_system_instruction() -> str:
    """Return the deterministic instruction passed to the orchestrator."""
    return (
        "You are Leo's orchestrator. You receive what the user said (often "
        "Hinglish/English code-switched). Produce a JSON object with exactly "
        "these keys:\n"
        "  - action: one of read | write | run | none\n"
        "- tool: human-readable tool name (e.g. 'read_file', 'write_file', 'run_script')\n"
        "  - args: object of tool arguments\n"
        "  - reason: one sentence why this tool was chosen\n"
        "  - steps: ordered array of tool-call steps for multi-step work\n"
        "Keep args minimal. Never emit prose outside the JSON."
    )


def plan_from_transcript(transcript: str, tools: list[dict]) -> dict:
    """Ask the orchestrator for a tool-call plan given the transcript.

    Args:
        transcript: Raw speech-to-text text.
        tools: Discoverable tool descriptors the agent may invoke.

    Returns:
        A dict with keys `action`, `tool`, `args`, `reason`, `steps`.

    Raises:
        OrchestratorError: If the orchestrator fails or the response is
        not valid tool-call JSON.
    """
    available = "\n".join(
        f"  - {t['name']}: {t.get('description', '')}" for t in tools
    )

    # Real deployments send this prompt to the Gnani Evon HTTP API.
    payload = {
        "transcript": transcript,
        "tools": tools,
        "system_instruction": build_system_instruction(),
    }

    if EVON_API_KEY is not None:
        try:
            response = requests.post(
                EVON_URL,
                json=payload,
                headers={"X-API-Key-ID": EVON_API_KEY},
                timeout=3,
            )
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as exc:
            raise OrchestratorError(f"Evon API request failed: {exc}") from exc

        if not isinstance(data, dict):
            raise OrchestratorError("Evon returned a non-object response")

        action = data.get("action")
        if action not in {"read", "write", "run", "none"}:
            raise OrchestratorError(f"Unexpected orchestrator action: {action!r}")

        return {
            "action": data.get("action", "none"),
            "tool": data.get("tool"),
            "args": data.get("args", {}),
            "reason": data.get("reason", ""),
            "steps": data.get("steps", []),
        }

    # Fallback: deterministic plan when no Evon API key is configured.
    # Keeps the controller testable without the upstream service.
    return _deterministic_plan(transcript, tools)


def _deterministic_plan(transcript: str, tools: list[dict]) -> dict:
    """Return a sensible plan when no Evon key is present."""
    normalized = transcript.lower().strip()
    path_map = {
        "read": "app/page.tsx",
        "write": "app/page.tsx",
        "run": "sandbox.py",
    }

    if any(w in normalized for w in ["read", "show", "view", "file", "open"]):
        action, tool = "read", "read_file"
    elif any(w in normalized for w in ["write", "create", "make", "build", "add", "new"]):
        action, tool = "write", "write_file"
    elif any(w in normalized for w in ["run", "execute", "execute code", "run script"]):
        action, tool = "run", "run_script"
    else:
        action, tool = "none", None

    steps = []
    if action in path_map:
        if tool == "read_file":
            steps.append({"tool": "read_file", "path": path_map[action]})
        elif tool == "write_file":
            steps.append({"tool": "write_file", "path": path_map[action], "code": "// placeholder"})
        elif tool == "run_script":
            steps.append({"tool": "run_script", "path": path_map[action]})

    return {
        "action": action,
        "tool": tool,
        "args": {},
        "reason": "Deterministic fallback; configure GNANI_API_KEY for full orchestration",
        "steps": steps,
    }
