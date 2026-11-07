"""Domain errors for the Leo voice-agent pipeline."""


class LeoPipelineError(Exception):
    """Base error for the Leo voice-agent pipeline."""


class GnaniSTTError(LeoPipelineError):
    """Gnani speech-to-text service returned an error or no speech."""


class GnaniLLMError(LeoPipelineError):
    """Gnani/Google LLM step raised an error."""


class ToolExecutionError(LeoPipelineError):
    """A tool failed to execute."""


class SandboxError(LeoPipelineError):
    """The workspace sandbox rejected or failed to run code."""


class OrchestratorError(LeoPipelineError):
    """The Evon orchestrator could not produce a plan."""


class WebSocketError(LeoPipelineError):
    """WebSocket send/receive failed mid-stream."""
