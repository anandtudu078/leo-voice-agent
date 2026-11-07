"""Gnani Evon orchestrator: turn a transcript into a tool-call plan.

The orchestrator is the agent-reasoning layer. Given the transcribed
voice command it asks an LLM to produce a JSON tool-call plan.
Production deployments would point at Gnani Evon; this module keeps a
pluggable interface so the real orchestrator can be swapped in.
"""

from __future__ import annotations

import json
import os

from .errors import OrchestratorError, ToolExecutionError

# In a real build this would instantiate a Gnani Evon client. The
# interface below keeps the controller layer free of downstream SDKs.
EVON_URL = os.getenv("EVON_URL", "https://api.vachana.ai/evon/v1")
EVON_API_KEY = os.getenv("GNANI_API_KEY")


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
    available = "\n".join(f"  - {t['name']}: {t.get('description', '')}" for t in tools)

    prompt = (
        "Available tools:\n"
        f"{available}\n\n"
        f'User said: "{transcript}"\n\n'
        f"{build_system_instruction()}\n\n"
        "Respond with ONLY the JSON object described above."
    )

    # Real deployments call the Gnani Evon HTTP API here.
    # This placeholder returns a deterministic sensible plan based on
    # well-known voice intents so the controller can be exercised end to
    # end without an orchestrator service present.
    normalized = transcript.lower().strip()

    plan = {
        "action": "none",
        "tool": None,
        "args": {},
        "reason": "No recognized tool intent",
        "steps": [],
    }

    if any(word in normalized for word in ["read", "show", "view", "file", "open"]):
        plan = {
            "action": "read",
            "tool": "read_file",
            "args": {"path": "app/page.tsx"},
            "reason": "User asked to show view code",
            "steps": [{"tool": "read_file", "path": "app/page.tsx"}],
        }
    elif any(
        word in normalized
        for word in ["write", "create", "make", "build", "add", "new"]
    ):
        plan = {
            "action": "write",
            "tool": "write_file",
            "args": {
                "path": "app/page.tsx",
                "code": "// placeholder written by orchestrator",
            },
            "reason": "User asked to create or add something",
            "steps": [
                {"tool": "write_file", "path": "app/page.tsx", "code": "// placeholder"}
            ],
        }
    elif any(
        word in normalized for word in ["run", "execute", "execute code", "run script"]
    ):
        plan = {
            "action": "run",
            "tool": "run_script",
            "args": {"path": "sandbox.py"},
            "reason": "User asked to run / execute code",
            "steps": [{"tool": "run_script", "path": "sandbox.py"}],
        }
    else:
        plan["action"] = "none"
        plan["reason"] = "No tool intent matched; awaiting clearer command"

    # In a real build, POST prompt to EVON_URL and parse the JSON response
    # from that service. The gateway keeps the same return shape.
    return plan
