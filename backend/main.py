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
import logging
import os
import re
import secrets
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from google import genai
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Imported after load_dotenv() so a DATABASE_URL from .env is picked up when
# the engine is created.
import repository
from db import init_db, ping_database
from edits import (
    EditError,
    NothingToUndo,
    RevisionNotFound,
    StaleEditError,
    apply_edit,
    build_proposal,
    build_restore_proposal,
    list_edit_history,
    propose_edit,
    undo_last_edit,
)
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


class ProposeEditRequest(BaseModel):
    path: str
    transcript: str
    selection: str = ""
    history: list[dict] | None = None


class ApplyEditRequest(BaseModel):
    path: str
    old_code: str
    new_code: str
    summary: str = ""


class UndoEditRequest(BaseModel):
    path: str = ""


class RestoreEditRequest(BaseModel):
    revision_id: int


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

# CORS middleware — allow Vercel (production + previews), localhost, and an
# explicit FRONTEND_URL. Needed for direct browser->backend calls (e.g. WebSocket
# from a Vercel preview to Render); Next.js rewrites are server-side and bypass CORS.
_frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        _frontend_url,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://leo-voice-agent.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
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
    Returns JSON: {"action": "createFile"|"writeFile"|"createFolder"|"editFile"|"runFile"|"none", "payload": {...}}."""
    import re

    body = await request.json()
    transcript = (body.get("transcript") or "").strip()
    if not transcript:
        return JSONResponse({"action": "none", "payload": None}, status_code=200)

    def _clean_path(raw: str) -> str:
        p = (raw or "").strip().strip('"').strip("'").strip("`")
        p = re.sub(r"[.,!?;:]+$", "", p).strip()
        p = re.sub(r"\s+dot\s+([a-zA-Z0-9]+)\b", r".\1", p, flags=re.IGNORECASE)
        p = re.sub(r"\s+", " ", p)
        return p

    def _extract_filename(text: str) -> str | None:
        m = re.search(r"\b([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b", text)
        return _clean_path(m.group(1)) if m else None

    def _strip_code_fences(text: str) -> str:
        t = (text or "").strip()
        m = re.search(r"```(?:[a-zA-Z0-9_+-]+)?\s*\n(.*?)```", t, flags=re.DOTALL)
        if m:
            return m.group(1).strip() + "\n"
        if t.startswith("```") and t.endswith("```"):
            return re.sub(r"^```[^\n]*\n?|```$", "", t).strip() + "\n"
        return t

    async def _generate_code(path: str, instruction: str) -> str:
        prompt = (
            "You are writing code for a file in an IDE. Return ONLY the complete, runnable "
            f"file contents for {path}. No markdown fences, no explanation.\n\n"
            f"User request: {instruction}\n"
        )
        started = time.time()
        try:
            result = await asyncio.to_thread(
                llm_provider.generate_text,
                contents=[{"role": "user", "parts": [{"text": prompt}]}],
                gemini_model=GEMINI_MODEL,
                task="code",
                prefer_fast=False,
            )
            text = result[0] if isinstance(result, tuple) else str(result)
            meta = result[2] if isinstance(result, tuple) and len(result) > 2 else {}
            logger.info("codegen path=%s provider=%s llm_ms=%s total_ms=%s", path, meta.get("provider"), meta.get("llm_ms"), int((time.time()-started)*1000))
            return _strip_code_fences((text or "").strip())
        except Exception as exc:
            logger.warning("codegen failed path=%s err=%s", path, type(exc).__name__)
            return ""

    try:
        try:
            plan = await asyncio.to_thread(plan_from_transcript, transcript, [])
        except Exception:
            plan = {}

        tl = transcript.lower()
        path = _extract_filename(transcript)
        wants_code = bool(
            re.search(
                r"\b(write|add|implement|create\s+(?:a\s+)?(?:function|class|method|code|script|program)|"
                r"put|insert|include|generate|build|make\s+(?:a\s+)?(?:function|class)|define|code\s+for|"
                r"with\s+(?:a\s+)?(?:function|class|code|this)|to\s+add|that\s+(?:adds|returns|prints|checks))\b",
                tl,
            )
        ) or ("```" in transcript)
        is_open_only = bool(re.search(r"^\s*(?:please\s+)?(?:open|show|read|view)\b", tl)) and not wants_code

        if plan.get("action") == "write" and plan.get("tool") == "write_file" and plan.get("path"):
            p = _clean_path(plan["path"])
            code = plan.get("code") or ""
            if not code and wants_code:
                code = await _generate_code(p, transcript)
            return JSONResponse(
                {"action": "writeFile" if code else "createFile", "payload": {"path": p, "code": code}},
                status_code=200,
            )
        if plan.get("action") == "read" and plan.get("tool") == "read_file" and plan.get("path") and not wants_code:
            return JSONResponse({"action": "editFile", "payload": {"path": _clean_path(plan["path"])}}, status_code=200)
        if plan.get("action") == "run" and plan.get("tool") == "run_script" and plan.get("path"):
            return JSONResponse({"action": "runFile", "payload": {"path": _clean_path(plan["path"])}}, status_code=200)

        # Coding write intent targeting a file: generate/insert code (must come before plain open).
        if path and wants_code and not re.search(r"\b(create|make|new)\b.*\b(folder|directory)\b", tl):
            code = await _generate_code(path, transcript)
            if code:
                return JSONResponse({"action": "writeFile", "payload": {"path": path, "code": code}}, status_code=200)
            # Don't overwrite an existing file with empty generated content.
            return JSONResponse({"action": "editFile", "payload": {"path": path}}, status_code=200)

        # Edit/open file (read-only intent).
        if re.search(r"\b(edit|modify|change|open|update|show|read|view)\b", tl) and not wants_code:
            if not path:
                m = re.search(r"\b(?:edit|modify|change|open|update|show|read|view)\s+(?:a\s+|the\s+)?(?:file\s+)?(.+)$", tl)
                path = _clean_path(m.group(1)) if m else None
            if path and not re.search(r"\b(create|make|new)\b.*\b(file|folder|directory)\b", tl):
                return JSONResponse({"action": "editFile", "payload": {"path": path}}, status_code=200)
        if is_open_only and path:
            return JSONResponse({"action": "editFile", "payload": {"path": path}}, status_code=200)

        # Create folder.
        if re.search(r"\b(create|make|new)\b.*\b(folder|directory)\b", tl):
            m = re.search(r"\b(?:folder|directory)\s+(?:named\s+|called\s+)?(.+)$", tl)
            if not m:
                m = re.search(r"\b(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+(?:named\s+|called\s+)?(.+)$", tl)
            path = _clean_path(m.group(1)) if m else "new-folder"
            return JSONResponse({"action": "createFolder", "payload": {"path": path}}, status_code=200)

        # Create file (optionally with generated code).
        if re.search(r"\b(create|make|new)\b.*\bfile\b", tl):
            if not path:
                m = re.search(r"\bfile\s+(?:named\s+|called\s+)?(.+)$", tl)
                path = _clean_path(m.group(1)) if m else "untitled.py"
            code = await _generate_code(path, transcript) if wants_code else ""
            return JSONResponse(
                {"action": "writeFile" if code else "createFile", "payload": {"path": path, "code": code}},
                status_code=200,
            )

        # Run/execute.
        if re.search(r"\b(run|execute|start)\b", tl):
            if not path:
                m = re.search(r"\b(?:run|execute|start)\s+(?:the\s+|file\s+|script\s+)?(.+)$", tl)
                path = _clean_path(m.group(1)) if m else None
            if path:
                return JSONResponse({"action": "runFile", "payload": {"path": path}}, status_code=200)

        # Last resort: coding request that names a file.
        if path and wants_code:
            code = await _generate_code(path, transcript)
            if code:
                return JSONResponse({"action": "writeFile", "payload": {"path": path, "code": code}}, status_code=200)
            return JSONResponse({"action": "editFile", "payload": {"path": path}}, status_code=200)

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
                {"type": "accept_edit", "path": "apply the pending diff"},
                {"type": "reject_edit", "path": "discard the pending diff"},
                {"type": "undo_edit", "path": "restore the last applied edit"},
                {"type": "history", "path": "list recent edits for a file"},
                {"type": "restore_edit", "revision_id": 1},
            ],
            "server_to_client": [
                {"type": "transcript", "text": "transcribed text"},
                {"type": "code", "code": "generated python code"},
                {"type": "plan", "action": "", "tool": "", "reason": ""},
                {"type": "assigned", "tool": "", "file": ""},
                {"type": "logs", "logs": []},
                {"type": "edit-proposal", "path": "", "summary": "", "diff": ""},
                {"type": "edit-result", "ok": True, "action": "apply|reject|undo|restore"},
                {"type": "edit-history", "path": "", "revisions": []},
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


# Note: /api/* is often proxied by Next.js, but the browser also connects directly
# to this backend for WebSocket (ws/wss). CORS is configured above.

# Initialize Google Gemini using the new google-genai SDK
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# gemini-2.5-flash is closed to new API keys and gemini-3.8-flash is often
# rate-limited upstream, so default to a model available to current keys.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

from llm_provider import LLMFallbackProvider

llm_provider = LLMFallbackProvider(gemini_client=client)

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


# ---------------------------------------------------------------------------
# Voice intent helpers for the reviewable-edit loop
# ---------------------------------------------------------------------------

_EDIT_VERBS = re.compile(
    r"\b(change|update|modify|edit|fix|refactor|rename|improve|optimize|adjust|"
    r"replace|rewrite|add|remove|insert|append|simplify|clean|make|write)\b",
    re.IGNORECASE,
)
_NOT_AN_EDIT = re.compile(
    r"\b(explain|teach|describe|what|why|how|create|new|folder|directory|run|"
    r"execute|start|open|show|read|view|list|undo|revert)\b",
    re.IGNORECASE,
)
_FILE_REQUEST = re.compile(
    r"\b(?:add|make|write|create|need)\s+(?:a\s+|the\s+)?(?:new\s+)?file\b",
    re.IGNORECASE,
)
_ACCEPT_EDIT = re.compile(
    r"^\s*(yes|yeah|yep|sure|ok|okay|apply|accept|looks\s+good|do\s+it|go\s+ahead)\b",
    re.IGNORECASE,
)
_REJECT_EDIT = re.compile(
    r"^\s*(no|nope|nah|cancel|reject|discard|don'?t|do\s+not)\b",
    re.IGNORECASE,
)
_UNDO_EDIT = re.compile(r"\b(undo|revert)\b", re.IGNORECASE)
_FILE_IN_TEXT = re.compile(r"\b([A-Za-z0-9_./-]+\.[A-Za-z][A-Za-z0-9]*)\b")


def _clean_path(raw: str | None) -> str:
    value = (raw or "").strip().strip('"').strip("'").strip("`")
    return re.sub(r"[.,!?;:]+$", "", value).strip()


def _target_file_path(transcript: str, active_path: str | None = None) -> str | None:
    """Prefer an explicit path in the request, then the file the user has open."""
    match = _FILE_IN_TEXT.search(transcript or "")
    if match:
        return _clean_path(match.group(1))
    return _clean_path(active_path) or None


def _is_edit_request(transcript: str) -> bool:
    text = (transcript or "").strip()
    if not text or _NOT_AN_EDIT.search(text) or _FILE_REQUEST.search(text):
        return False
    return bool(_EDIT_VERBS.search(text))


def _is_accept_edit(transcript: str) -> bool:
    return bool(_ACCEPT_EDIT.match(transcript or ""))


def _is_reject_edit(transcript: str) -> bool:
    return bool(_REJECT_EDIT.match(transcript or ""))


def _is_undo_request(transcript: str) -> bool:
    return bool(_UNDO_EDIT.search(transcript or ""))


async def _generate_reply(
    transcript: str,
    history: list[dict] | None = None,
    workspace: Path | None = None,
    on_delta: Callable[[str], None] | None = None,
) -> str:
    """Return Leo's spoken reply, with earlier turns as context."""
    system = SYSTEM_INSTRUCTION
    if workspace is not None:
        system = f"{system}\n\n{_workspace_summary(workspace)}"

    # Fast path: skip the optional Evon planning HTTP hint to avoid latency.
    # (Deterministic intent is not required for a conversational reply.)

    max_turns = 8  # last 8 messages (user+assistant pairs trimmed) for lower latency
    trimmed = [t for t in list(history or []) if t.get("text")][-max_turns:]
    contents = [
        {"role": turn["role"], "parts": [{"text": str(turn.get("text") or "")[:2000]}]}
        for turn in trimmed
    ]
    contents.append({"role": "user", "parts": [{"text": str(transcript or "")[:3000]}]})

    started = time.time()
    try:
        result = await asyncio.to_thread(
            llm_provider.generate_text,
            contents=contents,
            system_instruction=system,
            gemini_model=GEMINI_MODEL,
            task="reply",
            prefer_fast=True,
            on_delta=on_delta,
        )
        text = result[0] if isinstance(result, tuple) else str(result)
        meta = result[2] if isinstance(result, tuple) and len(result) > 2 else {}
        reply = (text or "").strip() or "I heard you, but I'm not sure what to say yet."
        logger.info("reply provider=%s model=%s llm_ms=%s total_ms=%s turns=%s", meta.get("provider"), meta.get("model"), meta.get("llm_ms"), int((time.time()-started)*1000), len(trimmed))
        return reply
    except Exception as exc:  # noqa: BLE001
        tl = (transcript or "").lower()
        import re as _re

        if _re.search(r"\b(run|execute|start)\b", tl):
            m = _re.search(r"\b([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b", transcript or "")
            if m:
                return f"I'll run {m.group(1)} now."
            return "I'll run that script now."
        if _re.search(r"\b(read|open|show|view)\b", tl):
            m = _re.search(r"\b([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b", transcript or "")
            if m:
                return f"I'll open {m.group(1)} for you."
        if _re.search(r"\b(create|make|write|add)\b.*\b(file|script|code)\b", tl):
            return "I'll create that file with the requested code."
        return f"I heard you. (LLM unavailable: {exc})"


async def _speak(text: str) -> bytes:
    """Convert Leo's text into audio bytes."""
    if not text:
        return b""
    try:
        return await asyncio.to_thread(tts_client.synthesize, text)
    except GnaniTTSError as exc:
        raise HTTPException(status_code=500, detail=f"Gnani TTS Error: {exc}") from exc


# ---------------------------------------------------------------------------
# WebSocket: streaming voice (audio in + code/logs out, existing)
# ---------------------------------------------------------------------------


@app.websocket("/ws/process-voice")
async def websocket_process_voice(websocket: WebSocket):
    """Voice IDE socket: audio/text in, transcript + spoken reply + files out."""
    try:
        await websocket.accept()
    except Exception:
        return
    try:
        workspace, workspace_id = await _workspace_context(_websocket_session(websocket))
        await websocket.send_json(
            {
                "type": "ready",
                "message": "Leo is listening. Speak or send a command.",
                "files": _workspace_files(workspace),
            }
        )
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "error": str(exc)})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
        return

    # Earlier turns of this conversation, so follow-ups have context.
    history: list[dict] = []
    # The last proposal is held per connection so voice "yes"/"no" and the
    # Accept/Reject buttons all resolve against the same diff.
    pending_edit: dict | None = None
    last_opened_path: str | None = None

    def _read_existing(path: str | None) -> str | None:
        if not path:
            return None
        try:
            return workspace_executor.read(workspace, path)
        except SandboxExecutionError:
            return None

    async def finish_turn(reply: str, *, streamed: bool) -> None:
        """Send the final reply, remember the turn, and speak it."""
        await websocket.send_json(
            {"type": "reply", "text": reply, "tts": "pending", "streamed": streamed}
        )
        history.extend(
            [
                {"role": "user", "text": transcript_for_turn},
                {"role": "model", "text": reply},
            ]
        )
        del history[:-12]
        if workspace_id is not None:
            asyncio.create_task(
                asyncio.to_thread(
                    repository.record_voice_turn, workspace_id, transcript_for_turn, reply
                )
            )
        try:
            audio = await _speak(reply)
        except HTTPException as exc:
            await websocket.send_json({"type": "error", "error": str(exc.detail)})
            audio = b""
        except Exception as exc:  # noqa: BLE001
            await websocket.send_json({"type": "error", "error": str(exc)})
            audio = b""
        await websocket.send_json(
            {
                "type": "speech",
                "speech": base64.b64encode(audio).decode("ascii") if audio else "",
                "text": reply,
                "audio_only": True,
            }
        )
        await websocket.send_json({"type": "listening", "message": "I'm listening now."})

    async def apply_pending(expected_path: str | None = None) -> tuple[bool, str]:
        nonlocal pending_edit
        proposal = pending_edit
        if proposal is None:
            await websocket.send_json(
                {"type": "edit-result", "ok": False, "action": "apply", "error": "No pending edit."}
            )
            return False, "There is no pending edit to apply."
        if expected_path and proposal.get("path") != expected_path:
            message = f"The pending edit is for {proposal.get('path')}, not {expected_path}."
            await websocket.send_json(
                {"type": "edit-result", "ok": False, "action": "apply", "error": message}
            )
            return False, message
        try:
            result = await asyncio.to_thread(
                apply_edit,
                executor=workspace_executor,
                workspace=workspace,
                workspace_id=workspace_id,
                path=proposal["path"],
                old_code=proposal["old_code"],
                new_code=proposal["new_code"],
                summary=proposal.get("summary", ""),
            )
        except StaleEditError as exc:
            pending_edit = None
            current = _read_existing(proposal.get("path"))
            if current is not None:
                await websocket.send_json(
                    {"type": "file", "path": proposal["path"], "content": current}
                )
            await websocket.send_json(
                {
                    "type": "edit-result",
                    "ok": False,
                    "action": "apply",
                    "path": proposal.get("path"),
                    "error": str(exc),
                }
            )
            return False, str(exc)
        except EditError as exc:
            await websocket.send_json(
                {
                    "type": "edit-result",
                    "ok": False,
                    "action": "apply",
                    "path": proposal.get("path"),
                    "error": str(exc),
                }
            )
            return False, str(exc)

        pending_edit = None
        await websocket.send_json(
            {
                "type": "file",
                "path": result["path"],
                "content": result["content"],
                "origin": "edit",
            }
        )
        await websocket.send_json(
            {
                "type": "logs",
                "logs": [f"> Applied edit to {result['path']}"],
                "files": _workspace_files(workspace),
            }
        )
        await websocket.send_json(
            {
                "type": "edit-result",
                "ok": True,
                "action": "apply",
                "path": result["path"],
                "content": result["content"],
                "revision_id": result.get("revision_id"),
                "undo_available": result.get("undo_available", False),
                "summary": result.get("summary", ""),
            }
        )
        return True, f"Applied the edit to {result['path']}."

    async def reject_pending() -> None:
        nonlocal pending_edit
        path = pending_edit.get("path") if pending_edit else ""
        pending_edit = None
        await websocket.send_json(
            {"type": "edit-result", "ok": True, "action": "reject", "path": path}
        )

    async def perform_undo(path: str | None) -> tuple[bool, str]:
        nonlocal pending_edit
        # Undo means abandon any proposal that has not been applied yet.
        pending_edit = None
        try:
            result = await asyncio.to_thread(
                undo_last_edit,
                executor=workspace_executor,
                workspace=workspace,
                workspace_id=workspace_id,
                path=path,
            )
        except (NothingToUndo, StaleEditError, EditError) as exc:
            await websocket.send_json(
                {"type": "edit-result", "ok": False, "action": "undo", "error": str(exc)}
            )
            return False, str(exc)
        await websocket.send_json(
            {
                "type": "file",
                "path": result["path"],
                "content": result["content"],
                "origin": "edit",
            }
        )
        await websocket.send_json(
            {
                "type": "logs",
                "logs": [f"> Restored {result['path']}"],
                "files": _workspace_files(workspace),
            }
        )
        await websocket.send_json(
            {
                "type": "edit-result",
                "ok": True,
                "action": "undo",
                "path": result["path"],
                "content": result["content"],
            }
        )
        return True, f"Restored {result['path']} to its previous version."

    async def send_proposal(proposal: dict, reply: str) -> None:
        nonlocal pending_edit
        if not proposal.get("changed"):
            await finish_turn(
                proposal.get("summary") or f"No changes to {proposal.get('path', 'the file')}.",
                streamed=False,
            )
            return
        pending_edit = proposal
        await websocket.send_json({"type": "edit-proposal", **proposal})
        await finish_turn(reply, streamed=False)

    # `finish_turn` uses the current transcript; set per turn below.
    transcript_for_turn = ""

    async def run_turn(
        transcript: str, active_path: str | None = None, selection: str = ""
    ) -> None:
        import re as _re

        nonlocal pending_edit, transcript_for_turn
        transcript_for_turn = transcript
        tl = (transcript or "").lower()
        target_path = _target_file_path(transcript, active_path or last_opened_path)
        target_content = _read_existing(target_path)

        await websocket.send_json({"type": "turn-started"})
        await websocket.send_json({"type": "waiting", "message": "Thinking..."})

        # 1. Undo is always available by voice, even while a proposal is pending.
        if _is_undo_request(transcript):
            _ok, message = await perform_undo(target_path)
            await finish_turn(message, streamed=False)
            return

        # 2. Resolve a pending proposal by voice before starting new work.
        if pending_edit is not None:
            if _is_accept_edit(transcript):
                _ok, message = await apply_pending()
                await finish_turn(message, streamed=False)
                return
            if _is_reject_edit(transcript):
                await reject_pending()
                await finish_turn("Discarded the pending edit.", streamed=False)
                return
            # A different command discards the proposal; tell the client so
            # its review panel does not outlive the server-side state.
            await reject_pending()

        # 3. Edit an existing file through a reviewable proposal, not a blind write.
        if target_path and target_content is not None and _is_edit_request(transcript):
            try:
                proposal = await asyncio.to_thread(
                    propose_edit,
                    provider=llm_provider,
                    model=GEMINI_MODEL,
                    path=target_path,
                    transcript=transcript,
                    current_code=target_content,
                    history=history,
                    selection=selection,
                )
            except EditError as exc:
                await finish_turn(str(exc), streamed=False)
                return
            await send_proposal(
                proposal,
                f"I prepared an edit to {target_path}. Review the diff, then accept or reject it.",
            )
            return

        loop = asyncio.get_running_loop()
        delta_q: asyncio.Queue[str | None] = asyncio.Queue()
        streamed = False

        def _on_delta(chunk: str) -> None:
            nonlocal streamed
            if chunk:
                streamed = True
                try:
                    loop.call_soon_threadsafe(delta_q.put_nowait, chunk)
                except Exception:
                    pass

        async def _drain_deltas():
            while True:
                item = await delta_q.get()
                if item is None:
                    break
                try:
                    await websocket.send_json({"type": "reply_delta", "delta": item})
                except Exception:
                    break

        drain_task = asyncio.create_task(_drain_deltas())
        try:
            reply = await _generate_reply(
                transcript, history=history, workspace=workspace, on_delta=_on_delta
            )
        except HTTPException as exc:
            try:
                await delta_q.put(None); await drain_task
            except Exception:
                pass
            if _re.search(r"\b(run|execute|start)\b", tl):
                m = _re.search(r"\b([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)\b", transcript or "")
                if m:
                    try:
                        output = await asyncio.to_thread(workspace_executor.run, workspace, m.group(1))
                        await websocket.send_json({"type": "logs", "logs": [output.strip() or f"> {m.group(1)} finished with no output"], "run": {"path": m.group(1), "ok": True, "output": output}})
                        await websocket.send_json({"type": "listening", "message": "I'm listening now."})
                        return
                    except SandboxExecutionError as sexc:
                        await websocket.send_json({"type": "logs", "logs": [str(sexc)], "run": {"path": m.group(1), "ok": False, "output": str(sexc)}})
                        await websocket.send_json({"type": "listening", "message": "I'm listening now."})
                        return
                await websocket.send_json({"type": "logs", "logs": ["Which file should I run?"]})
                await websocket.send_json({"type": "listening", "message": "I'm listening now."})
                return
            await websocket.send_json({"type": "error", "error": str(exc.detail)})
            await websocket.send_json({"type": "listening", "message": "I'm listening now."})
            return
        try:
            await delta_q.put(None); await drain_task
        except Exception:
            pass

        # If the agent's reply contains a fenced code block for an existing file,
        # turn it into a reviewable proposal instead of overwriting the file.
        try:
            wants_code = bool(
                _re.search(
                    r"\b(write|add|implement|create|update|modify|change|put|insert|include|generate|build|make|define|code|function|class|script|program)\b",
                    tl,
                )
            )
            file_m = _FILE_IN_TEXT.search(transcript or "")
            if not file_m:
                file_m = _FILE_IN_TEXT.search(reply or "")
            code_m = _re.search(r"```(?:[a-zA-Z0-9_+-]+)?\s*\n(.*?)```", reply or "", flags=_re.DOTALL)
            if wants_code and file_m and code_m:
                target_path = file_m.group(1).strip().strip('"').strip("'").strip("`")
                code_text = (code_m.group(1) or "").rstrip() + "\n"
                if target_path and code_text.strip():
                    existing = _read_existing(target_path)
                    if existing is not None:
                        proposal = build_proposal(
                            target_path,
                            existing,
                            code_text,
                            f"Updated {target_path} from your request.",
                        )
                        if proposal["changed"]:
                            pending_edit = proposal
                            await websocket.send_json({"type": "edit-proposal", **proposal})
                            await websocket.send_json(
                                {
                                    "type": "logs",
                                    "logs": [f"> Prepared a reviewable edit for {target_path}"],
                                    "files": _workspace_files(workspace),
                                }
                            )
                    else:
                        saved = workspace_executor.write(workspace, target_path, code_text)
                        if workspace_id is not None:
                            try:
                                await asyncio.to_thread(
                                    repository.save_file_snapshot, workspace_id, target_path, code_text
                                )
                            except Exception:
                                pass
                        await websocket.send_json({"type": "file", "path": target_path, "content": code_text})
                        await websocket.send_json(
                            {
                                "type": "logs",
                                "logs": [f"> Saved {target_path} ({saved})"],
                                "files": _workspace_files(workspace),
                            }
                        )
        except Exception:
            # Never fail the conversational turn because of auto-save.
            pass

        await finish_turn(reply, streamed=streamed)


    async def handle_audio(audio: bytes, active_path: str | None = None) -> None:
        try:
            transcript = await asyncio.to_thread(
                stt_client.transcribe, audio, "microphone.wav", "audio/wav"
            )
        except GnaniSTTError as exc:
            await websocket.send_json({"type": "error", "error": str(exc)})
            return
        await websocket.send_json({"type": "transcript", "transcript": transcript})
        await run_turn(transcript, active_path=active_path or last_opened_path)

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
                    await handle_audio(audio, active_path=path or last_opened_path)

            elif msg_type == "text":
                transcript = str(payload.get("text") or "").strip()
                if transcript:
                    selection = str(payload.get("selection") or "")
                    await websocket.send_json({"type": "transcript", "transcript": transcript})
                    await run_turn(
                        transcript,
                        active_path=path or last_opened_path,
                        selection=selection,
                    )

            elif msg_type in {"read_file", "editFile", "edit_file", "open_file"}:
                try:
                    content = workspace_executor.read(workspace, path)
                except SandboxExecutionError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                last_opened_path = path or last_opened_path
                await websocket.send_json({"type": "file", "path": path, "content": content})

            elif msg_type == "accept_edit":
                await apply_pending(path or None)

            elif msg_type == "reject_edit":
                await reject_pending()

            elif msg_type == "undo_edit":
                await perform_undo(path or last_opened_path)

            elif msg_type == "history":
                history_path = path or last_opened_path or None
                revisions = await asyncio.to_thread(
                    list_edit_history,
                    workspace_id=workspace_id,
                    path=history_path,
                )
                await websocket.send_json(
                    {
                        "type": "edit-history",
                        "path": history_path or "",
                        "revisions": revisions,
                        "signed_in": workspace_id is not None,
                    }
                )

            elif msg_type == "restore_edit":
                try:
                    revision_id = int(payload.get("revision_id"))
                except (TypeError, ValueError):
                    await websocket.send_json(
                        {"type": "error", "error": "A valid revision_id is required."}
                    )
                    continue
                try:
                    proposal = await asyncio.to_thread(
                        build_restore_proposal,
                        executor=workspace_executor,
                        workspace=workspace,
                        workspace_id=workspace_id,
                        revision_id=revision_id,
                    )
                except EditError as exc:
                    await websocket.send_json({"type": "error", "error": str(exc)})
                    continue
                if not proposal["changed"]:
                    await websocket.send_json(
                        {
                            "type": "edit-result",
                            "ok": True,
                            "action": "restore",
                            "path": proposal["path"],
                            "message": proposal["summary"],
                        }
                    )
                    continue
                pending_edit = proposal
                await websocket.send_json({"type": "edit-proposal", **proposal})
                await websocket.send_json(
                    {
                        "type": "logs",
                        "logs": [f"> Prepared a restore of {proposal['path']}"],
                        "files": _workspace_files(workspace),
                    }
                )

            elif msg_type in {"create_file", "write_file"}:
                code = str(payload.get("code") or "")
                existing = _read_existing(path)
                if existing is not None and existing != code:
                    proposal = build_proposal(
                        path,
                        existing,
                        code,
                        f"Updated {path} from your request.",
                    )
                    pending_edit = proposal
                    await websocket.send_json({"type": "edit-proposal", **proposal})
                    await websocket.send_json(
                        {
                            "type": "logs",
                            "logs": [f"> Prepared a reviewable edit for {path}"],
                            "files": _workspace_files(workspace),
                        }
                    )
                    continue
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
    except Exception:
        # Avoid unhandled exceptions tearing down the connection.
        pass
    finally:
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
        except Exception:
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
                        await websocket.send_json({"type": "reply", "text": reply, "tts": "pending"})
                        if workspace_id is not None:
                            asyncio.create_task(
                                asyncio.to_thread(repository.record_voice_turn, workspace_id, text, reply)
                            )
                        try:
                            audio = await _speak(reply)
                        except Exception as exc:  # noqa: BLE001
                            await websocket.send_json({"type": "error", "message": str(exc)})
                            audio = b""
                        await websocket.send_json(
                            {
                                "type": "speech",
                                "audio": base64.b64encode(audio).decode("ascii") if audio else "",
                                "text": reply,
                                "audio_only": True,
                            }
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


# ---------------------------------------------------------------------------
# Context-aware edit proposals (review before write)
# ---------------------------------------------------------------------------


@app.post("/api/agent/propose-edit")
async def propose_edit_endpoint(request: Request, payload: ProposeEditRequest):
    """Return a reviewable diff for a requested edit; writes nothing."""
    workspace, _ = await _workspace_context(request.state.session)
    path = payload.path.strip()
    transcript = payload.transcript.strip()
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    if not transcript:
        raise HTTPException(status_code=400, detail="transcript is required")
    try:
        current = await asyncio.to_thread(workspace_executor.read, workspace, path)
    except SandboxExecutionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        proposal = await asyncio.to_thread(
            propose_edit,
            provider=llm_provider,
            model=GEMINI_MODEL,
            path=path,
            transcript=transcript,
            current_code=current,
            history=payload.history or [],
            selection=payload.selection,
        )
    except EditError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return proposal


@app.post("/api/agent/apply-edit")
async def apply_edit_endpoint(request: Request, payload: ApplyEditRequest):
    """Apply a reviewed diff if the file still matches the proposal's base."""
    workspace, workspace_id = await _workspace_context(request.state.session)
    try:
        result = await asyncio.to_thread(
            apply_edit,
            executor=workspace_executor,
            workspace=workspace,
            workspace_id=workspace_id,
            path=payload.path,
            old_code=payload.old_code,
            new_code=payload.new_code,
            summary=payload.summary,
        )
    except StaleEditError as exc:
        current = None
        try:
            current = await asyncio.to_thread(
                workspace_executor.read, workspace, payload.path
            )
        except SandboxExecutionError:
            pass
        return JSONResponse(
            {"detail": str(exc), "current_content": current}, status_code=409
        )
    except EditError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "files": _workspace_files(workspace)}


@app.get("/api/agent/history")
async def edit_history_endpoint(request: Request, path: str = ""):
    """List recent agent edits for a file, newest first."""
    _workspace, workspace_id = await _workspace_context(request.state.session)
    revisions = await asyncio.to_thread(
        list_edit_history, workspace_id=workspace_id, path=path.strip() or None
    )
    return {
        "path": path,
        "revisions": revisions,
        "signed_in": workspace_id is not None,
    }


@app.post("/api/agent/restore-preview")
async def restore_preview_endpoint(request: Request, payload: RestoreEditRequest):
    """Build a reviewable diff back to the version before an earlier edit."""
    workspace, workspace_id = await _workspace_context(request.state.session)
    try:
        proposal = await asyncio.to_thread(
            build_restore_proposal,
            executor=workspace_executor,
            workspace=workspace,
            workspace_id=workspace_id,
            revision_id=payload.revision_id,
        )
    except RevisionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EditError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return proposal


@app.post("/api/agent/undo")
async def undo_edit_endpoint(request: Request, payload: UndoEditRequest):
    """Restore the newest un-undone agent edit for a file or workspace."""
    workspace, workspace_id = await _workspace_context(request.state.session)
    path = payload.path.strip() or None
    try:
        result = await asyncio.to_thread(
            undo_last_edit,
            executor=workspace_executor,
            workspace=workspace,
            workspace_id=workspace_id,
            path=path,
        )
    except (NothingToUndo, StaleEditError, EditError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {**result, "files": _workspace_files(workspace)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)


class ExplainCodeRequest(BaseModel):
    path: str = ""
    code: str = ""
    language: str = ""
    goal: str = ""


def _fallback_explain_steps(code: str, path: str, goal: str) -> list[dict]:
    """Deterministic, line-based explanation when the LLM is unavailable."""
    lines = code.splitlines() or [""]
    steps: list[dict] = []
    i = 0
    n = len(lines)
    chunk = 0
    while i < n and chunk < 80:
        while i < n and not lines[i].strip():
            i += 1
        if i >= n:
            break
        start = i + 1
        j = i
        nonempty = 0
        while j < n and nonempty < 6:
            if not lines[j].strip():
                if nonempty > 0:
                    break
                j += 1
                continue
            nonempty += 1
            j += 1
        end = j
        block = "\n".join(lines[i:j]).strip()
        low = block.lower()
        title = "Code step"
        what = "This part of the program runs as written."
        syntax: list[str] = []
        if "import " in low or low.startswith("from "):
            title = "Imports"
            what = "Loads modules or names so the code can use existing functionality."
            syntax = ["import", "modules"]
        elif "def " in block:
            title = "Function definition"
            what = "Defines a reusable block of code that can be called by name."
            syntax = ["def", "parameters", "function body"]
        elif "class " in block:
            title = "Class definition"
            what = "Defines a type/object blueprint with its data and behavior."
            syntax = ["class", "methods"]
        elif "if " in block or "elif " in block or "else" in block:
            title = "Conditional logic"
            what = "Chooses what to do based on whether a condition is true."
            syntax = ["if/elif/else", "conditions"]
        elif "for " in block or "while " in block:
            title = "Loop"
            what = "Repeats actions for each item or while a condition holds."
            syntax = ["loops", "iteration"]
        elif "try" in block or "except" in block:
            title = "Error handling"
            what = "Handles failures safely instead of crashing unexpectedly."
            syntax = ["try/except"]
        elif "input(" in block:
            title = "User input"
            what = "Reads input. Note: Leo's sandbox runs scripts non-interactively, so use arguments/defaults for runnable demos."
            syntax = ["input()", "variables"]
        elif "print(" in block or "console.log" in block:
            title = "Output"
            what = "Displays a result to the user or terminal."
            syntax = ["print()/console.log", "output"]
        elif "return " in block:
            title = "Return value"
            what = "Sends a result back from a function."
            syntax = ["return"]
        elif "=" in block and "==" not in block:
            title = "Assignment / setup"
            what = "Stores a value in a name so it can be used later."
            syntax = ["variables", "assignment"]
        why = f"It supports the requested goal: {goal}." if goal else f"It helps implement the behavior in {path or 'this file'}."
        steps.append({"startLine": start, "endLine": end, "title": title, "what": what, "why": why, "syntax": syntax, "code": block[:1200]})
        i = j
        chunk += 1
    if not steps:
        steps.append({"startLine": 1, "endLine": max(1, n), "title": "File overview", "what": "This file contains the generated code.", "why": f"It was created for: {goal}." if goal else "It implements the requested behavior.", "syntax": [], "code": code[:1200]})
    return steps


def _parse_explain_json(text: str, code: str, path: str, goal: str) -> list[dict]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()
    try:
        data = json.loads(raw)
    except Exception:
        for a, b in (("{", "}"), ("[", "]")):
            s = raw.find(a)
            e = raw.rfind(b)
            if s != -1 and e != -1 and e > s:
                try:
                    data = json.loads(raw[s : e + 1])
                    break
                except Exception:
                    pass
        else:
            return _fallback_explain_steps(code, path, goal)
    steps = data.get("steps") if isinstance(data, dict) else data
    if not isinstance(steps, list) or not steps:
        return _fallback_explain_steps(code, path, goal)
    n = max(1, len(code.splitlines()))
    out: list[dict] = []
    for s in steps[:120]:
        if not isinstance(s, dict):
            continue
        try:
            start = max(1, min(n, int(s.get("startLine", 1))))
            end = max(start, min(n, int(s.get("endLine", start))))
        except Exception:
            continue
        out.append({
            "startLine": start, "endLine": end,
            "title": str(s.get("title") or "Code step")[:120],
            "what": str(s.get("what") or "")[:1200],
            "why": str(s.get("why") or "")[:1200],
            "syntax": [str(x)[:80] for x in (s.get("syntax") or []) if x][:12] if isinstance(s.get("syntax"), list) else [],
            "code": "\n".join(code.splitlines()[start - 1 : end])[:1200],
        })
    return out or _fallback_explain_steps(code, path, goal)


@app.post("/api/explain-code")
async def explain_code(request: Request, payload: ExplainCodeRequest):
    """Return a structured, line-by-line walkthrough of workspace code."""
    workspace, _ = await _workspace_context(request.state.session)
    code = payload.code
    path = (payload.path or "").strip()
    if not code and path:
        try:
            code = workspace_executor.read(workspace, path)
        except SandboxExecutionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not code.strip():
        raise HTTPException(status_code=400, detail="No code to explain")
    goal = (payload.goal or "").strip()
    language = (payload.language or "").strip() or ("python" if path.endswith(".py") else "code")
    lines = code.splitlines()
    if len(lines) > 500:
        code = "\n".join(lines[:500]) + "\n# ... (truncated for explanation)"
    prompt = (
        "You are Leo, a coding tutor. Explain the user's code for learning. "
        "Return ONLY valid JSON (no markdown) with this shape: "
        "{\"steps\":[{\"startLine\":1,\"endLine\":2,\"title\":\"...\",\"what\":\"What it does\","
        "\"why\":\"Why it was written for the goal\",\"syntax\":[\"concept\"]}]}. "
        "Cover the entire file in logical chunks (usually 1-8 lines each). Be accurate, beginner-friendly, "
        "and mention syntax/concepts being used. "
        f"Path: {path or 'untitled'}. Language: {language}. Goal: {goal or 'implement the user request'}.\n\nCODE:\n" + code
    )
    started = time.time()
    try:
        result = await asyncio.to_thread(
            llm_provider.generate_text,
            contents=prompt,
            gemini_model=GEMINI_MODEL,
            task="explain",
            prefer_fast=False,
        )
        text = result[0] if isinstance(result, tuple) else str(result)
        provider = result[1] if isinstance(result, tuple) and len(result) > 1 else "unknown"
        meta = result[2] if isinstance(result, tuple) and len(result) > 2 else {}
        logger.info("explain path=%s provider=%s llm_ms=%s total_ms=%s", path, provider, meta.get("llm_ms"), int((time.time()-started)*1000))
        steps = _parse_explain_json(text or "", code, path, goal)
        return {"path": path, "language": language, "steps": steps, "provider": provider}
    except Exception:
        steps = _fallback_explain_steps(code, path, goal)
        return {"path": path, "language": language, "steps": steps, "provider": "fallback"}
