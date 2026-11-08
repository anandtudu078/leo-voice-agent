"""Leo Voice Agent API.

FastAPI controller that receives voice, transcribes with Gnani STT, reasons
with the Evon orchestrator + Gemini LLM, and replies with Gnani TTS.

Routes:
    POST /api/process-voice  - one-shot audio -> text + generated code
    GET  /docs               - interactive Swagger UI
    GET  /openapi.json        - OpenAPI 3.1 schema
    WS   /ws/process-voice    - streaming audio + transcription + plan + code
    WS   /ws/talk             - bidirectional voice conversation (STT -> agent -> TTS)
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import requests
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import requests as http_requests
from fastapi import FastAPI, Body, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

load_dotenv()


# ---------------------------------------------------------------------------
# Session store
#
# The project has no database yet, so the session is held in memory and
# mirrored to a signed cookie on the client. Signing uses a project secret
# (LEO_SESSION_SECRET) with a strong random fallback so tokens cannot be
# forged.
# ---------------------------------------------------------------------------

SESSION_COOKIE = "freebuff_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

_LEO_SESSION_SECRET = os.getenv("LEO_SESSION_SECRET") or secrets.token_urlsafe(48)


def _sign(payload: bytes) -> str:
    return hmac.new(_LEO_SESSION_SECRET.encode(), payload, hashlib.sha256).hexdigest()


def _encode_session(email: str) -> str:
    """Return a signed session token for `email`."""
    now = datetime.now(timezone.utc).isoformat()
    payload = json.dumps(
        {"email": email, "iat": now, "exp": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=") + "." + _sign(payload)


def _decode_session(token: str) -> dict | None:
    """Return the decoded payload if `token` is a valid, unexpired session."""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, sig = parts
        expected = _sign(payload_b64.encode())
        if not hmac.compare_digest(sig, expected):
            return None
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
        exp = datetime.fromisoformat(payload.get("exp", ""))
        if exp.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            return None
        return payload
    except Exception:
        return None


def read_session(request_headers: dict) -> dict | None:
    """Read the session cookie from the request headers and validate it."""
    cookie = request_headers.get("cookie") or ""
    for part in cookie.split(";"):
        key, _, value = part.strip().partition("=")
        if key == SESSION_COOKIE:
            return _decode_session(value)
    return None


def write_session(email: str) -> str:
    """Create a signed session token for `email`."""
    return _encode_session(email)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SignInRequest(BaseModel):
    email: str
    password: str


class SignInResponse(JSONResponse):
    """Auth success response with the session cookie."""

    def __init__(self, content: dict, status_code: int = 200):
        super().__init__(content, status_code=status_code)
        self.set_cookie(
            key=SESSION_COOKIE,
            value=content.get("_session", ""),
            path="/",
            httponly=True,
            secure=os.getenv("NODE_ENV") == "production",
            samesite="Lax",
            max_age=SESSION_MAX_AGE,
        )


app = FastAPI(title="Leo Voice Agent API")


# ---------------------------------------------------------------------------
# Public API: authentication
#
# Demo auth: any well-formed email is a valid account. This matches the
# project's "free forever, funded by ads" promise — there is no password
# comparison and no database yet. The endpoint returns a signed
# `freebuff_session` cookie plus a JSON body, and the client mirrors the
# session into localStorage so routes can read the same state.
# ---------------------------------------------------------------------------


@app.post("/api/auth/signin")
async def auth_signin(req: SignInRequest):
    email = req.email.strip()
    if not email:
        return JSONResponse({"detail": "Email is required."}, status_code=400)
    if "@" not in email:
        return JSONResponse({"detail": "Enter a valid email address."}, status_code=400)

    token = write_session(email)
    return SignInResponse({"user": {"email": email}, "_session": token})


# ---------------------------------------------------------------------------
# WebSocket capability endpoints for frontend self-tests
# ---------------------------------------------------------------------------


@app.get("/api/capabilities")
async def get_capabilities():
    """Return the WebSocket channels this process supports."""
    return {
        "channels": [
            "/ws/talk",
            "/ws/process-voice",
            "/api/process-voice",
            "/api/tts",
        ],
        "protocol": {
            "client_to_server": [
                {"type": "audio", "data": "base64(plain/wav/mp3) audio bytes"},
                {"type": "text", "text": "voice or text command"},
            ],
            "server_to_client": [
                {"type": "transcript", "text": "transcribed text"},
                {"type": "code", "code": "generated python code"},
                {"type": "plan", "action": "", "tool": "", "reason": ""},
                {"type": "assigned", "tool": "", "file": ""},
                {"type": "logs", "logs": []},
                {"type": "turn-started"},
                {"type": "waiting", "message": ""},
                {"type": "listening", "message": ""},
                {"type": "speech", "audio": "base64(audio bytes)"},
                {"type": "tts-ready", "message": ""},
                {"type": "closed", "message": ""},
            ],
        },
    }


@app.post("/api/echo")
async def echo(msg: str = Body(default="hello")):
    """Self-test echo endpoint used by frontend capability checks."""
    return {"echo": msg, "channels": [
        "/ws/talk",
        "/ws/process-voice",
        "/api/process-voice",
        "/api/tts",
    ]}


# CORS middleware
#
# `allow_credentials=True` forbids wildcard origins, so restrict CORS to
# the known frontend host(s) so signed cookies transmit correctly in the
# browser. Set LEO_FRONTEND_ORIGIN to widen or narrow it.
_leo_frontend_origins = os.getenv("LEO_FRONTEND_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_leo_frontend_origins],
    allow_credentials=True,
    allow_methods=["*", "POST", "GET", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Initialize Google Gemini using the new google-genai SDK
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

GNANI_API_KEY = os.getenv("GNANI_API_KEY")
GNANI_STT_URL = os.getenv("GNANI_STT_URL", "https://api.vachana.ai/stt/v3")
GNANI_TTS_URL = os.getenv("GNANI_TTS_URL", "https://api.vachana.ai/tts/v3")

from pipeline.orchestrator import plan_from_transcript
from pipeline.stt import GnaniSTTClient, GnaniSTTError
from pipeline.tts import GnaniTTSClient, GnaniTTSError
from sandbox import SandboxExecutor

stt_client = GnaniSTTClient()
tts_client = GnaniTTSClient()


# ---------------------------------------------------------------------------
# Shared helper: transcript -> spoken reply (STT -> LLM -> TTS)
# ---------------------------------------------------------------------------


async def _transcribe_audio(audio_bytes: bytes, filename: str, content_type: str) -> str:
    try:
        return stt_client.transcribe(audio_bytes, filename, content_type)
    except GnaniSTTError as exc:
        raise HTTPException(status_code=500, detail=f"Gnani STT Error: {exc}") from exc


async def _generate_reply(transcript: str) -> str:
    """Run Evon planning, fall back to Gemini, and return Leo's spoken text."""
    tools = [
        {"name": "read_file", "description": "Read a file"},
        {"name": "write_file", "description": "Write a file"},
        {"name": "run_script", "description": "Run a script"},
    ]
    try:
        plan = plan_from_transcript(transcript, tools)
        # Evon fired a real tool call: report intent, leave the actual execution to the
        # caller (HTTP returns code + logs, WebSocket routes it through the sandbox).
        if plan.get("action") in {"read", "write", "run"} and plan.get("tool"):
            return (
                f"Planned: {plan['action']} with {plan['tool']}. "
                "I'll run it now. "
                f"Reason: {plan.get('reason', '')}"
            )
    except Exception as exc:  # noqa: BLE001
        # Evon is optional; fall through to plain Gemini.
        pass

    try:
        response = client.models.generate_content(
            model="gemini-3.8-flash",
            contents=f"{SYSTEM_INSTRUCTION}\n\nUser: {transcript}",
        )
        return response.text or "I understood that, but I have nothing to do right now."
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gemini LLM Error: {exc}") from exc


async def _speak(text: str) -> bytes:
    """Convert Leo's text into audio bytes."""
    if not text:
        return b""
    try:
        return tts_client.synthesize(text)
    except GnaniTTSError as exc:
        raise HTTPException(status_code=500, detail=f"Gnani TTS Error: {exc}") from exc


# ---------------------------------------------------------------------------
# WebSocket: streaming voice (audio in + code/logs out, existing)
# ---------------------------------------------------------------------------


@app.websocket("/ws/process-voice")
async def websocket_process_voice(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({
        "type": "ready",
        "message": "Leo is listening. Speak.",
        "code": "",
        "plan": {"action": "none", "tool": "", "reason": ""},
        "assigned": {"tool": "", "file": ""},
        "logs": [],
        "tts-ready": "Ready for next turn.",
    })

    audio_chunks: list[bytes] = []
    try:
        while True:
            data = await websocket.receive_bytes()
            if data is None:
                continue
            audio_chunks.append(data)
            # Stream transcription as the user speaks
            if len(audio_chunks) >= 8000:
                try:
                    transcript = stt_client.transcribe(
                        b"".join(audio_chunks), "microphone.wav", "audio/webm"
                    )
                    if transcript:
                        await websocket.send_json({"type": "transcript", "transcript": transcript})
                        audio_chunks = []
                except GnaniSTTError:
                    audio_chunks = []
    except WebSocketDisconnect:
        pass
    finally:
        if audio_chunks:
            try:
                transcript = stt_client.transcribe(
                    b"".join(audio_chunks), "microphone.wav", "audio/webm"
                )
                if transcript:
                    await websocket.send_json({"type": "transcript", "transcript": transcript})
            except GnaniSTTError:
                pass
        await websocket.send_json({"type": "stopped", "message": "Done listening."})


# ---------------------------------------------------------------------------
# HTTP: studio capstone (code + logs, existing HTTP endpoint removed)
# ---------------------------------------------------------------------------


@app.post("/api/process-voice")
async def process_voice_text(text: str = Body(...)):
    """One-shot: receive a text command, transcribe+generate (kept for HTTP tests)."""
    try:
        reply_text = await _generate_reply(text)
        return {"text": text, "reply": reply_text}
    except HTTPException as exc:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# New: bidirectional voice conversation (STT -> agent -> TTS)
# ---------------------------------------------------------------------------


@app.websocket("/ws/talk")
async def websocket_talk(websocket: WebSocket):
    """Bidirectional voice conversation.

    Protocol (JSON lines):
        Client -> Server : {"type": "audio", "data": "base64(plain/wav/mp3) audio bytes"}
                          {"type": "text", "text": "I want a..."}
        Server -> Client : {"type": "transcript", "text": "..."}
        Server -> Client : {"type": "speech", "audio": "base64(audio bytes)"}
        Server -> Client : {"type": "done", "message": "..."}
    """
    await websocket.accept()
    await websocket.send_json({"type": "ready", "message": "Leo is listening. Speak or type."})

    pending_audio: list[bytes] = []

    def flush_audio() -> bytes:
        nonlocal pending_audio
        if pending_audio:
            data = b"".join(pending_audio)
            pending_audio = []
            return data
        return b""

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "audio":
                # Chrome's MediaRecorder sends base64 audio; the backend decodes it.
                payload = message.get("data", "")
                if isinstance(payload, str) and payload:
                    try:
                        import base64

                        pending_audio.append(base64.b64decode(payload))
                    except Exception:  # noqa: BLE001
                        await websocket.send_json({"type": "error", "message": "Bad audio payload"})
                else:
                    pending_audio.append(payload.encode() if isinstance(payload, str) else payload)

            elif msg_type == "text":
                text = message.get("text", "").strip()
                if text:
                    await websocket.send_json({"type": "transcript", "text": text})
                    await websocket.send_json({"type": "turn-started"})
                    try:
                        await websocket.send_json({"type": "waiting", "message": "Thinking..."})
                        reply = await _generate_reply(text)
                        audio = await _speak(reply)
                        if audio:
                            await websocket.send_json(
                                {"type": "speech", "audio": base64.b64encode(audio).decode("ascii")}
                            )
                        else:
                            await websocket.send_json(
                                {"type": "speech", "audio": base64.b64encode(b"").decode("ascii")}
                            )
                        await websocket.send_json({"type": "listening", "message": "I'm listening now."})
                    except HTTPException as exc:
                        await websocket.send_json({"type": "error", "message": exc.detail})
                    except Exception as exc:  # noqa: BLE001
                        await websocket.send_json({"type": "error", "message": str(exc)})

            elif msg_type == "code":
                # Frontend sent generated code for execution / log recording.
                code = message.get("code", "")
                if code:
                    await websocket.send_json({"type": "code", "code": code})
                    try:
                        from pipeline.sandbox import SandboxExecutor

                        executor = SandboxExecutor()
                        result = await executor.run(code)
                        await websocket.send_json({"type": "logs", "logs": [result]})
                    except Exception as exc:  # noqa: BLE001
                        await websocket.send_json({"type": "error", "message": str(exc)})

            elif msg_type == "plan":
                # Frontend received a plan from the orchestrator; log it for display.
                plan = message.get("plan", {})
                if plan:
                    await websocket.send_json({"type": "plan", "plan": plan})

            elif msg_type == "assigned":
                # Frontend reported which tool/file the agent is working on.
                tool = message.get("tool", "")
                file = message.get("file", "")
                if tool or file:
                    await websocket.send_json({"type": "assigned", "tool": tool, "file": file})

            elif msg_type == "logs":
                # Frontend flushed accumulated logs.
                logs = message.get("logs", [])
                if logs:
                    await websocket.send_json({"type": "logs", "logs": logs})

            elif msg_type == "tts-ready":
                # Agent finished synthesizing audio; ready for next turn.
                message_ = message.get("message", "")
                if message_:
                    await websocket.send_json({"type": "tts-ready", "message": message_})
                else:
                    await websocket.send_json({"type": "tts-ready", "message": "Ready for next turn."})

            elif msg_type == "stop":
                break

    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.send_json({"type": "closed", "message": "Goodbye!"})
        except Exception:
            pass

        # ---- one-shot fallback: if the client sent audio but no turns were processed
        if pending_audio:
            try:
                transcript = stt_client.transcribe(
                    b"".join(pending_audio), "microphone.wav", "audio/webm"
                )
                if transcript:
                    await websocket.send_json({"type": "transcript", "text": transcript})
                    reply = await _generate_reply(transcript)
                    audio = await _speak(reply)
                    if audio:
                        await websocket.send_json(
                            {"type": "speech", "audio": base64.b64encode(audio).decode("ascii")}
                        )
            except GnaniSTTError:
                pass


# ---------------------------------------------------------------------------
# File access endpoint: list/read files from the system workspace
# ---------------------------------------------------------------------------


@app.exception_handler(404)
async def not_found_handler(request, exc):
    return {"detail": "Not Found"}


@app.get("/api/files")
async def list_files(directory: str = "session"):
    """List files under the workspace (relative path, no traversal)."""
    from pathlib import Path

    root = Path(os.getenv("LEO_WORKSPACE_ROOT", ".")).resolve()
    if not os.path.exists(root):
        root.mkdir(parents=True, exist_ok=True)

    target = (root / directory).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return {"files": [], "directories": [], "path": str(target), "error": "Access denied"}

    if not target.exists():
        target.mkdir(parents=True, exist_ok=True)

    files = []
    directories = []
    for p in sorted(target.iterdir(), key=lambda x: (x.is_file(), x.name.lower())):
        rel = p.relative_to(root)
        if p.is_dir():
            directories.append(str(rel) + "/")
        else:
            try:
                size = p.stat().st_size
            except OSError:
                size = 0
            files.append(f"{rel} ({size}B)")
    return {"files": files, "directories": directories, "path": str(target)}


# ---------------------------------------------------------------------------
# HTTP helper: convert text -> audio (used by streaming routes for playback)
# ---------------------------------------------------------------------------


@app.post("/api/tts")
async def tts_synthesize(text: str):
    """Return the agent's spoken audio bytes for a given text."""
    if not text:
        return {"audio": b"", "type": "empty"}
    audio = await _speak(text)
    return {"audio": base64.b64encode(audio).decode("ascii"), "type": "base64"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
