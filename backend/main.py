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

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

load_dotenv()

# Imported after load_dotenv() so a DATABASE_URL from .env is picked up when
# the engine is created.
import repository
from db import init_db, ping_database
from pipeline.orchestrator import plan_from_transcript


# ---------------------------------------------------------------------------
# Session store
#
# Users live in the database (a row is created on first sign-in) and the
# session itself is a signed cookie. Signing uses a project secret
# (LEO_SESSION_SECRET) with a strong random fallback so tokens cannot be
# forged.
# ---------------------------------------------------------------------------

SESSION_COOKIE = "freebuff_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

_LEO_SESSION_SECRET = os.getenv("LEO_SESSION_SECRET") or secrets.token_urlsafe(48)


def _sign(payload: bytes) -> str:
    return hmac.new(_LEO_SESSION_SECRET.encode(), payload, hashlib.sha256).hexdigest()


def _encode_session(email: str, user_id: int | None = None) -> str:
    """Return a signed session token for `email` and its database id."""
    now = datetime.now(timezone.utc)
    payload = json.dumps(
        {
            "email": email,
            "uid": user_id,
            "iat": now.isoformat(),
            "exp": (now + timedelta(days=7)).isoformat(),
        },
        separators=(",", ":"),
    ).encode()
    # Sign the encoded payload: _decode_session verifies the base64 segment.
    encoded = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    return encoded + "." + _sign(encoded.encode())


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


def write_session(email: str, user_id: int | None = None) -> str:
    """Create a signed session token for `email`."""
    return _encode_session(email, user_id)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SignInRequest(BaseModel):
    email: str
    password: str = ""


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


class EmailRequest(BaseModel):
    email: str


def _email_signin_response(user: dict) -> JSONResponse:
    """Sign `user` in and return the same shape as /api/auth/signin."""
    token = write_session(user["email"], user["id"])
    response = JSONResponse(
        {"user": {"email": user["email"], "id": user["id"]}, "_session": token}
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        path="/",
        httponly=True,
        secure=os.getenv("NODE_ENV") == "production",
        samesite="lax",
        max_age=SESSION_MAX_AGE,
    )
    return response


app = FastAPI(title="Leo Voice Agent API")

# CORS middleware — allow the Vercel frontend (and localhost for dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:3000"),
        "https://leo-voice-agent.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create missing tables on import so a fresh clone and the test suite work
# without a separate migration step.
init_db()


@app.get("/")
@app.head("/")
async def root():
    """Root probe for Render/browser checks."""
    return {
        "status": "ok",
        "service": "leo-voice-agent-backend",
        "health": "/api/health",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health():
    """Liveness probe for Render (and any uptime monitor). Returns instantly."""
    return {"status": "ok"}


@app.get("/api/db-health")
async def db_health():
    """Optional: database reachability probe. Returns instantly; the IDE does not use it by default."""
    database_ok = await asyncio.to_thread(ping_database)
    return {"database": "connected" if database_ok else "unavailable"}


@app.post("/api/parse-voice-command")
async def parse_voice_command(request: Request):
    """Extract intent from a voice transcript.
    Returns JSON: {"action": "createFile"|"createFolder"|"editFile"|"runFile"|"none", "payload": {...}}."""
    import re

    body = await request.json()
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        return JSONResponse({"action": "none", "payload": None}, status_code=200)

    def _clean_path(raw: str) -> str:
        p = (raw or "").strip().strip('"').strip("'").strip("`")
        # strip trailing punctuation from speech artifacts
        p = re.sub(r"[.,!?;:]+$", "", p).strip()
        # common spoken forms: "dot py" -> ".py"
        p = re.sub(r"\s+dot\s+([a-zA-Z0-9]+)\b", r".\1", p, flags=re.IGNORECASE)
        p = re.sub(r"\s+", " ", p)
        return p

    def _extract_filename(text: str) -> str | None:
        m = re.search(r"\b([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b", text)
        return _clean_path(m.group(1)) if m else None

    try:
        # Try the LLM planner first (best effort).
        try:
            plan = await asyncio.to_thread(plan_from_transcript, transcript, [])
        except Exception:
            plan = {}

        if plan.get("action") == "read" and plan.get("tool") == "read_file" and plan.get("path"):
            return JSONResponse({"action": "editFile", "payload": {"path": _clean_path(plan["path"])}}, status_code=200)
        if plan.get("action") == "write" and plan.get("tool") == "write_file" and plan.get("path"):
            return JSONResponse(
                {"action": "createFile", "payload": {"path": _clean_path(plan["path"]), "code": plan.get("code") or ""}},
                status_code=200,
            )
        if plan.get("action") == "run" and plan.get("tool") == "run_script" and plan.get("path"):
            return JSONResponse({"action": "runFile", "payload": {"path": _clean_path(plan["path"])}}, status_code=200)

        # Deterministic keyword fallback (robust to phrasing).
        tl = transcript.lower()

        # Edit/open file (check before generic create/run where phrasing overlaps).
        if re.search(r"\b(edit|modify|change|open|update)\b.*\bfile\b|\bfile\b.*\b(edit|modify|change|open|update)\b", tl):
            path = _extract_filename(transcript)
            if not path:
                m = re.search(r"\b(?:edit|modify|change|open|update)\s+(?:a\s+|the\s+)?(?:file\s+)?(.+)$", tl)
                path = _clean_path(m.group(1)) if m else None
            if path:
                return JSONResponse({"action": "editFile", "payload": {"path": path}}, status_code=200)

        # Create folder.
        if re.search(r"\b(create|make|new)\b.*\b(folder|directory)\b", tl):
            m = re.search(r"\b(?:folder|directory)\s+(?:named\s+|called\s+)?(.+)$", tl)
            if not m:
                m = re.search(r"\b(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+(?:named\s+|called\s+)?(.+)$", tl)
            path = _clean_path(m.group(1)) if m else "new-folder"
            return JSONResponse({"action": "createFolder", "payload": {"path": path}}, status_code=200)

        # Create file.
        if re.search(r"\b(create|make|new)\b.*\bfile\b", tl):
            path = _extract_filename(transcript)
            if not path:
                m = re.search(r"\bfile\s+(?:named\s+|called\s+)?(.+)$", tl)
                path = _clean_path(m.group(1)) if m else "untitled.py"
            return JSONResponse({"action": "createFile", "payload": {"path": path, "code": ""}}, status_code=200)

        # Run/execute.
        if re.search(r"\b(run|execute|start)\b", tl):
            path = _extract_filename(transcript)
            if not path:
                m = re.search(r"\b(?:run|execute|start)\s+(?:the\s+|file\s+|script\s+)?(.+)$", tl)
                path = _clean_path(m.group(1)) if m else None
            if path:
                return JSONResponse({"action": "runFile", "payload": {"path": path}}, status_code=200)

        return JSONResponse({"action": "none", "payload": None}, status_code=200)
    except Exception as e:
        return JSONResponse({"action": "none", "payload": None, "error": str(e)}, status_code=200)


@app.middleware("http")
async def attach_session(request: Request, call_next):
    """Decode the signed session cookie once per request."""
    token = request.cookies.get(SESSION_COOKIE)
    request.state.session = _decode_session(token) if token else None
    return await call_next(request)


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

    user = await asyncio.to_thread(repository.get_or_create_user, email)
    token = write_session(user["email"], user["id"])
    return SignInResponse(
        {"user": {"email": user["email"], "id": user["id"]}, "_session": token}
    )


@app.get("/api/auth/me")
async def auth_me(request: Request):
    """Return the currently signed-in user, or 401 if there is none."""
    session = request.state.session
    if not session or not session.get("email"):
        raise HTTPException(status_code=401, detail="Not signed in")

    user = None
    if session.get("uid") is not None:
        user = await asyncio.to_thread(repository.get_user, session["uid"])
    if user is None:
        user = await asyncio.to_thread(repository.get_user_by_email, session["email"])
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return {"user": {"email": user["email"], "id": user["id"]}}


@app.post("/api/auth/signout")
async def auth_signout(request: Request):
    """Invalidate the signed session cookie on the client."""
    response = JSONResponse({"detail": "Signed out."}, status_code=200)
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        secure=os.getenv("NODE_ENV") == "production",
        samesite="Lax",
    )
    return response


@app.post("/api/auth/signup")
async def auth_signup(payload: EmailRequest):
    """Create (or reuse) an account and sign the user in."""
    email = payload.email.strip()
    if "@" not in email:
        return JSONResponse({"detail": "Enter a valid email address."}, status_code=400)
    user = await asyncio.to_thread(repository.get_or_create_user, email)
    return _email_signin_response(user)


@app.post("/api/auth/login")
async def auth_login(payload: EmailRequest):
    """Sign in an existing account (created on first use)."""
    email = payload.email.strip()
    if "@" not in email:
        return JSONResponse({"detail": "Enter a valid email address."}, status_code=400)
    user = await asyncio.to_thread(repository.get_or_create_user, email)
    return _email_signin_response(user)


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


# CORS middleware is disabled: the Next.js frontend proxies /api/* to
# http://localhost:8000/api/*, so the browser never sends cross-origin
# requests to the backend directly. Remove CORSMiddleware to avoid the known
# Starlette bug where it crashes on 404 responses.

# Initialize Google Gemini using the new google-genai SDK
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# gemini-2.5-flash is closed to new API keys and gemini-3.8-flash is often
# rate-limited upstream, so default to a model available to current keys.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

SYSTEM_INSTRUCTION = (
    "You are Leo, a voice coding assistant inside a browser IDE. You are having "
    "a spoken conversation: keep answers short and natural (at most three "
    "sentences) unless the user asks for code, in which case reply with the code "
    "and one line of context. Remember the earlier turns of the conversation and "
    "use them for follow-ups. Use the workspace file list when it helps, and "
    "never claim to have run or saved something you did not do."
)

GNANI_API_KEY = os.getenv("GNANI_API_KEY")

from pipeline.orchestrator import plan_from_transcript
from pipeline.stt import GnaniSTTClient, GnaniSTTError
from pipeline.tts import GnaniTTSClient, GnaniTTSError
from sandbox import SandboxExecutionError, SandboxExecutor

stt_client = GnaniSTTClient()
tts_client = GnaniTTSClient()

# The voice IDE edits one workspace directory per user. Files never leave it.
RUN_SCRIPT_NAME = "snippet.py"


def _workspace_root() -> Path:
    root = Path(os.getenv("LEO_WORKSPACE_ROOT", "session")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


workspace_executor = SandboxExecutor(root=_workspace_root())


def _workspace_for(user_id: int | None) -> Path:
    """Return the workspace directory owned by `user_id`.

    Signed-in users get their own directory; requests without a session share
    a clearly named ``anonymous`` directory so local checks still work.
    """
    label = f"user-{user_id}" if user_id is not None else "anonymous"
    return workspace_executor.workspace(label)


async def _workspace_context(session: dict | None) -> tuple[Path, int | None]:
    """Resolve the caller's workspace directory and database workspace id."""
    user_id = (session or {}).get("uid")
    if user_id is None:
        return _workspace_for(None), None
    workspace_id = await asyncio.to_thread(repository.get_or_create_workspace, user_id)
    return _workspace_for(user_id), workspace_id


def _websocket_session(websocket: WebSocket) -> dict | None:
    """Decode the session cookie sent with a WebSocket handshake."""
    token = websocket.cookies.get(SESSION_COOKIE)
    return _decode_session(token) if token else None


IGNORED_WORKSPACE_NAMES = {".git", "node_modules", "__pycache__", ".venv", ".next"}


def _workspace_files(workspace: Path) -> list[dict]:
    """List workspace entries (directories and files) as ``path``/``name``/``kind``."""
    entries: list[dict] = []
    for path in sorted(workspace.rglob("*")):
        relative = path.relative_to(workspace)
        if any(part in IGNORED_WORKSPACE_NAMES for part in relative.parts):
            continue
        entries.append(
            {
                "path": relative.as_posix(),
                "name": path.name,
                "kind": "dir" if path.is_dir() else "file",
            }
        )
        if len(entries) >= 500:
            break
    return entries


def _decode_audio(payload: str) -> bytes:
    """Decode base64 audio, accepting the `data:` URL prefix FileReader adds."""
    if payload.startswith("data:"):
        payload = payload.split(",", 1)[-1]
    return base64.b64decode(payload)


# ---------------------------------------------------------------------------
# Shared helper: transcript -> spoken reply (STT -> LLM -> TTS)
# ---------------------------------------------------------------------------


def _workspace_summary(workspace: Path) -> str:
    """One-line description of the workspace, used to ground the conversation."""
    files = [
        entry["path"] for entry in _workspace_files(workspace) if entry["kind"] == "file"
    ]
    if not files:
        return "The user's workspace is currently empty."
    shown = ", ".join(files[:30])
    more = f" and {len(files) - 30} more" if len(files) > 30 else ""
    return f"Files in the user's workspace: {shown}{more}."


async def _generate_reply(
    transcript: str,
    history: list[dict] | None = None,
    workspace: Path | None = None,
) -> str:
    """Return Leo's spoken reply, with the earlier turns as context."""
    tools = [
        {"name": "read_file", "description": "Read a file"},
        {"name": "write_file", "description": "Write a file"},
        {"name": "run_script", "description": "Run a script"},
    ]

    system = SYSTEM_INSTRUCTION
    if workspace is not None:
        system = f"{system}\n\n{_workspace_summary(workspace)}"

    # The orchestrator is optional: when it recognises a tool intent we only
    # mention it to the model, so the reply stays conversational instead of
    # claiming work that has not happened.
    try:
        plan = await asyncio.to_thread(plan_from_transcript, transcript, tools)
        if plan.get("action") in {"read", "write", "run"} and plan.get("tool"):
            system += (
                f"\n\nThe user is probably asking to {plan['action']} a file "
                f"with {plan['tool']}. Ask a short clarifying question if you "
                "need the file name or the change."
            )
    except Exception:  # noqa: BLE001
        pass

    contents = [
        {"role": turn["role"], "parts": [{"text": turn["text"]}]}
        for turn in list(history or [])[-12:]
        if turn.get("text")
    ]
    contents.append({"role": "user", "parts": [{"text": transcript}]})

    try:
        response = await asyncio.to_thread(
            client.models.generate_content,
            model=GEMINI_MODEL,
            contents=contents,
            config={"system_instruction": system},
        )
        reply = (response.text or "").strip()
        return reply or "I heard you, but I'm not sure what to say yet."
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
    """Voice IDE socket: audio/text in, transcript + spoken reply + files out.

    Client -> Server (JSON):
        {"type": "audio", "data": "base64 or data: URL"}
        {"type": "text", "text": "voice command"}
        {"type": "read_file", "path": "main.py"}
        {"type": "create_file" | "write_file", "path": "main.py", "code": "..."}
        {"type": "delete_file", "path": "main.py"}
        {"type": "run_script", "path": "main.py"}
    Server -> Client (JSON):
        {"type": "ready", "files": [...]}
        {"type": "transcript", "transcript": "..."}
        {"type": "turn-started"} | {"type": "waiting"} | {"type": "listening"}
        {"type": "speech", "speech": "base64 audio", "text": "spoken reply"}
        {"type": "file", "path": "...", "content": "..."}
        {"type": "logs", "logs": [...]}
        {"type": "error", "error": "..."}
    """
    await websocket.accept()
    workspace, workspace_id = await _workspace_context(_websocket_session(websocket))
    await websocket.send_json(
        {
            "type": "ready",
            "message": "Leo is listening. Speak or send a command.",
            "files": _workspace_files(workspace),
        }
    )

    # Earlier turns of this conversation, so follow-ups have context.
    history: list[dict] = []

    async def run_turn(transcript: str) -> None:
        await websocket.send_json({"type": "turn-started"})
        await websocket.send_json({"type": "waiting", "message": "Thinking..."})
        try:
            reply = await _generate_reply(
                transcript, history=history, workspace=workspace
            )
        except HTTPException as exc:
            await websocket.send_json({"type": "error", "error": str(exc.detail)})
            return
        try:
            audio = await _speak(reply)
        except HTTPException as exc:
            # Keep the conversation moving: show the reply even when TTS fails.
            await websocket.send_json({"type": "error", "error": str(exc.detail)})
            audio = b""
        await websocket.send_json(
            {
                "type": "speech",
                "speech": base64.b64encode(audio).decode("ascii") if audio else "",
                "text": reply,
            }
        )
        history.extend(
            [
                {"role": "user", "text": transcript},
                {"role": "model", "text": reply},
            ]
        )
        del history[:-12]
        if workspace_id is not None:
            await asyncio.to_thread(
                repository.record_voice_turn, workspace_id, transcript, reply
            )
        await websocket.send_json({"type": "listening", "message": "I'm listening now."})

    async def handle_audio(audio: bytes) -> None:
        try:
            transcript = await asyncio.to_thread(
                stt_client.transcribe, audio, "microphone.wav", "audio/wav"
            )
        except GnaniSTTError as exc:
            await websocket.send_json({"type": "error", "error": str(exc)})
            return
        await websocket.send_json({"type": "transcript", "transcript": transcript})
        await run_turn(transcript)

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            binary = message.get("bytes")
            if binary:
                # Backwards compatibility: clients that stream raw audio frames.
                await handle_audio(binary)
                continue

            frame = message.get("text")
            if not frame:
                continue

            try:
                payload = json.loads(frame)
            except ValueError:
                await websocket.send_json({"type": "error", "error": "Invalid JSON message"})
                continue
            if not isinstance(payload, dict):
                await websocket.send_json(
                    {"type": "error", "error": "Message must be a JSON object"}
                )
                continue

            msg_type = payload.get("type")
            path = str(payload.get("path") or "")

            if msg_type == "audio":
                try:
                    audio = _decode_audio(str(payload.get("data") or ""))
                except (binascii.Error, ValueError):
                    await websocket.send_json({"type": "error", "error": "Bad audio payload"})
                    continue
                if audio:
                    await handle_audio(audio)

            elif msg_type == "text":
                transcript = str(payload.get("text") or "").strip()
                if transcript:
                    await websocket.send_json({"type": "transcript", "transcript": transcript})
                    await run_turn(transcript)

            elif msg_type in {"read_file", "editFile", "edit_file", "open_file"}:
                try:
                    content = workspace_executor.read(workspace, path)
                except SandboxExecutionError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                await websocket.send_json({"type": "file", "path": path, "content": content})

            elif msg_type in {"create_file", "write_file"}:
                code = str(payload.get("code") or "")
                try:
                    saved = workspace_executor.write(workspace, path, code)
                except SandboxExecutionError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                if workspace_id is not None and path:
                    try:
                        await asyncio.to_thread(
                            repository.save_file_snapshot, workspace_id, path, code
                        )
                    except Exception:
                        # Non-fatal: file is saved on disk; DB snapshot is best-effort.
                        pass
                await websocket.send_json({"type": "file", "path": path, "content": code})
                await websocket.send_json(
                    {
                        "type": "logs",
                        "logs": [f"> Saved {path} ({saved})"],
                        "files": _workspace_files(workspace),
                    }
                )

            elif msg_type == "delete_file":
                try:
                    workspace_executor.remove(workspace, path)
                except SandboxExecutionError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                if workspace_id is not None and path:
                    try:
                        await asyncio.to_thread(
                            repository.delete_file_snapshot, workspace_id, path
                        )
                    except Exception:
                        pass
                await websocket.send_json(
                    {
                        "type": "logs",
                        "logs": [f"> Deleted {path}"],
                        "files": _workspace_files(workspace),
                    }
                )

            elif msg_type == "mkdir":
                try:
                    workspace_executor.make_dir(workspace, path)
                except SandboxExecutionError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                await websocket.send_json(
                    {
                        "type": "logs",
                        "logs": [f"> Created folder {path}"],
                        "files": _workspace_files(workspace),
                    }
                )

            elif msg_type == "rename_file":
                new_path = str(payload.get("new_path") or "")
                try:
                    workspace_executor.rename(workspace, path, new_path)
                except SandboxExecutionError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                if workspace_id is not None and path:
                    await asyncio.to_thread(
                        repository.delete_file_snapshot, workspace_id, path
                    )
                await websocket.send_json(
                    {
                        "type": "logs",
                        "logs": [f"> Renamed {path} to {new_path}"],
                        "files": _workspace_files(workspace),
                    }
                )

            elif msg_type == "run_script":
                try:
                    output = await asyncio.to_thread(workspace_executor.run, workspace, path)
                except SandboxExecutionError as exc:
                    await websocket.send_json(
                        {
                            "type": "logs",
                            "logs": [str(exc)],
                            "run": {"path": path, "ok": False, "output": str(exc)},
                        }
                    )
                    continue
                await websocket.send_json(
                    {
                        "type": "logs",
                        "logs": [output.strip() or f"> {path} finished with no output"],
                        "run": {"path": path, "ok": True, "output": output},
                    }
                )

            else:
                await websocket.send_json(
                    {"type": "error", "error": f"Unsupported message type: {msg_type!r}"}
                )
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass


# ---------------------------------------------------------------------------
# HTTP: studio capstone (code + logs, existing HTTP endpoint removed)
# ---------------------------------------------------------------------------


@app.post("/api/process-voice")
async def process_voice_text(payload: dict | str = Body(...)):
    """One-shot: receive a text command and return the agent's reply.

    Accepts either a raw JSON string (`"hello"`) or `{"text": "hello"}`.
    """
    text = payload.get("text", "") if isinstance(payload, dict) else payload
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
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
    workspace, workspace_id = await _workspace_context(_websocket_session(websocket))
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
                        if workspace_id is not None:
                            await asyncio.to_thread(
                                repository.record_voice_turn, workspace_id, text, reply
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
                        workspace_executor.write(workspace, RUN_SCRIPT_NAME, code)
                        result = await asyncio.to_thread(
                            workspace_executor.run, workspace, RUN_SCRIPT_NAME
                        )
                        await websocket.send_json({"type": "logs", "logs": [result]})
                    except SandboxExecutionError as exc:
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
                    b"".join(pending_audio), "microphone.wav", "audio/wav"
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
    return JSONResponse(status_code=404, content={"detail": "Not Found"})


@app.get("/api/files")
async def list_files(request: Request, directory: str = ""):
    """List files under the caller's own workspace (no traversal)."""
    workspace, _ = await _workspace_context(request.state.session)
    root = workspace.resolve()

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
        rel = p.relative_to(root).as_posix()
        if p.is_dir():
            directories.append(rel + "/")
        else:
            try:
                size = p.stat().st_size
            except OSError:
                size = 0
            files.append(f"{rel} ({size}B)")
    return {"files": files, "directories": directories, "path": str(target)}


# ---------------------------------------------------------------------------
# File management endpoints


@app.post("/api/files/mkdir")
async def mkdir_file(request: Request, path: str = Body(..., embed=True, description="Directory path to create")):
    """Create a new directory in the user's workspace."""
    workspace, _ = await _workspace_context(request.state.session)
    root = workspace.resolve()
    target = (root / path).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return {"error": "Access denied"}
    if not target.exists():
        target.mkdir(parents=True, exist_ok=True)
    return {"path": str(target), "created": True}


@app.post("/api/files/rm")
async def rm_file(request: Request, path: str = Body(..., embed=True, description="File or directory path to remove")):
    """Remove a file or directory from the user's workspace."""
    workspace, _ = await _workspace_context(request.state.session)
    root = workspace.resolve()
    target = (root / path).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return {"error": "Access denied"}
    if target.is_dir():
        import shutil
        shutil.rmtree(target)
    elif target.is_file():
        target.unlink()
    return {"path": str(target), "removed": True}


# ---------------------------------------------------------------------------
# File editing endpoints used by the IDE (HTTP fallback / primary path)
# ---------------------------------------------------------------------------


class FileWriteRequest(BaseModel):
    path: str
    code: str = ""


class FileRenameRequest(BaseModel):
    path: str
    new_path: str


class FileRunRequest(BaseModel):
    path: str


@app.get("/api/files/tree")
async def file_tree(request: Request):
    """Return every file and directory in the caller's workspace."""
    workspace, _ = await _workspace_context(request.state.session)
    return {"files": _workspace_files(workspace)}


@app.get("/api/files/read")
async def read_file_endpoint(request: Request, path: str):
    """Return the text content of a workspace file."""
    workspace, _ = await _workspace_context(request.state.session)
    try:
        content = workspace_executor.read(workspace, path)
    except SandboxExecutionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"path": path, "content": content}


@app.post("/api/files/write")
async def write_file_endpoint(request: Request, payload: FileWriteRequest):
    """Create or overwrite a workspace file and snapshot it in the database."""
    workspace, workspace_id = await _workspace_context(request.state.session)
    if not payload.path.strip():
        raise HTTPException(status_code=400, detail="path is required")
    try:
        saved = workspace_executor.write(workspace, payload.path, payload.code)
    except SandboxExecutionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if workspace_id is not None:
        await asyncio.to_thread(
            repository.save_file_snapshot, workspace_id, payload.path, payload.code
        )
    return {"path": payload.path, "saved": saved, "files": _workspace_files(workspace)}


@app.post("/api/files/rename")
async def rename_file_endpoint(request: Request, payload: FileRenameRequest):
    """Rename or move a file/directory inside the workspace."""
    workspace, workspace_id = await _workspace_context(request.state.session)
    try:
        workspace_executor.rename(workspace, payload.path, payload.new_path)
    except SandboxExecutionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if workspace_id is not None:
        await asyncio.to_thread(
            repository.delete_file_snapshot, workspace_id, payload.path
        )
    return {"path": payload.new_path, "files": _workspace_files(workspace)}


@app.post("/api/files/run")
async def run_file_endpoint(request: Request, payload: FileRunRequest):
    """Run a workspace script in the sandbox and return its output."""
    workspace, _ = await _workspace_context(request.state.session)
    try:
        output = await asyncio.to_thread(
            workspace_executor.run, workspace, payload.path
        )
    except SandboxExecutionError as exc:
        return {"path": payload.path, "ok": False, "output": str(exc)}
    return {"path": payload.path, "ok": True, "output": output}


# ---------------------------------------------------------------------------


@app.get("/api/history")
async def voice_history(request: Request, limit: int = 50):
    """Return the signed-in user's recent voice turns, newest first."""
    session = request.state.session
    if not session or session.get("uid") is None:
        return {"turns": []}
    workspace_id = await asyncio.to_thread(
        repository.get_or_create_workspace, session["uid"]
    )
    turns = await asyncio.to_thread(repository.list_voice_turns, workspace_id, limit)
    return {"turns": turns}


# ---------------------------------------------------------------------------
# HTTP helper: convert text -> audio (used by streaming routes for playback)
# ---------------------------------------------------------------------------


@app.post("/api/tts")
async def tts_synthesize(text: str):
    """Return the agent's spoken audio bytes for a given text."""
    if not text:
        return {"audio": "", "type": "empty"}
    audio = await _speak(text)
    return {"audio": base64.b64encode(audio).decode("ascii"), "type": "base64"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
