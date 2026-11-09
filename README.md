# Leo Voice Agent

A voice-driven full-stack app: a Next.js (React 19 + Next 16) frontend streams audio over WebSockets to a FastAPI backend, which hands the audio to Gnani STT and runs a Gemini 2.5 Flash code-generation step. The resulting code is displayed in the browser. The architecture is orchestrated by Gnani Evon.

## ✨ Features

### Phase 1: Voice IDE Status Indicators
- **Voice Status Bar** — Fixed top-center display showing real-time voice state (idle/listening/processing/error/ready) with color-coded pulses and animations
- **Pipeline Visualizer** — Three colored dots (STT → Agent → TTS) showing live pipeline stage status with staggered bounce animations
- **Voice State Management** — Integrated state machine tracking voice status transitions via WebSocket messages

### Phase 2: Command Workflow
- **Voice Command History** — Scrollable area showing recent transcripts, generated code, execution results, and TTS audio players
- **Command Palette** — Cmd+K / Ctrl+K inspired searchable palette with quick actions (New Project, Open File, Refactor, Debug, New Terminal)
- **Context-Aware Prompting** — Dynamic suggestion box that updates based on detected context (file-viewed, recent-actions, selection)

### Phase 3: Hands-Free & Persistence
- **Hands-Free Recording Mode** — Toggle continuous listening without keyboard interaction
- **Voice Session Persistence** — Remembers last active file, voice history memory, focused file, and recent files across sessions
- **Enhanced Execution Results** — Detailed tracking with pass/fail indicators for tests, output, errors, and TTS audio
- **Voice Command Learning** — Tracks frequently used commands and prioritizes them in the palette via frequency mapping

## ✨ Features

### Phase 1: Voice IDE Status Indicators
- **Voice Status Bar** — Fixed top-center display showing real-time voice state (idle/listening/processing/error/ready) with color-coded pulses and animations
- **Pipeline Visualizer** — Three colored dots (STT → Agent → TTS) showing live pipeline stage status with staggered bounce animations
- **Voice State Management** — Integrated state machine tracking voice status transitions via WebSocket messages

### Phase 2: Command Workflow
- **Voice Command History** — Scrollable area showing recent transcripts, generated code, execution results, and TTS audio players
- **Command Palette** — Cmd+K / Ctrl+K inspired searchable palette with quick actions (New Project, Open File, Refactor, Debug, New Terminal)
- **Context-Aware Prompting** — Dynamic suggestion box that updates based on detected context (file-viewed, recent-actions, selection)

### Phase 3: Hands-Free & Persistence
- **Hands-Free Recording Mode** — Toggle continuous listening without keyboard interaction
- **Voice Session Persistence** — Remembers last active file, voice history memory, focused file, and recent files across sessions
- **Enhanced Execution Results** — Detailed tracking with pass/fail indicators for tests, output, errors, and TTS audio
- **Voice Command Learning** — Tracks frequently used commands and prioritizes them in the palette via frequency mapping

## Architecture

```text
FRONTEND NEXT.JS WORKBENCH
    ▲
    │  [1] Audio Streams via WebSockets
    │
    │  [5] WebSocket Update (Code Patch + Log Strings)
BACKEND FASTAPI CONTROLLER
    │
    ├───────────────────────────────  [unreadable]ENT PIPELINE LAYER
    │
GNANI PRISMA (Speech-to-Text)          GNANI TIMBRE (Text-to-Speech)
    │                                          ▲
    ▼                                          │
[2] Raw Text                               [6] Audio Stream
    │                                          │
    ▼                                          ▼
GNANI EVON ORCHESTRATOR (Agent Reasoning / #1 BFCL v3)
    │                                          ▲
    │  [3] Function Trigger (Tool Call Intent) │
    ▼                                          │
EXECUTION TOOLS (Read / Write / Run Scripts)
    ▼
WORKSPACE SANDBOX (sandbox.py / js)
```

### Data flow (numbered arrows in the diagram)

1. **[1] Audio Streams via WebSockets** — The Next.js frontend records microphone audio and streams it to the backend over WebSockets.
2. **[2] Raw Text** — Gnani Prisma converts the audio to text.
3. **[3] Function Trigger (Tool Call Intent)** — The Gnani Evon orchestrator interprets the transcript as a function-call / tool-intent request.
4. **[4] Tool Execution Results (Success / Terminal Errors)** — Execution tool results (success or terminal errors) flow back into the orchestrator.
5. **[5] WebSocket Update (Code Patch + Log Strings)** — The backend pushes a code patch and log strings to the frontend over WebSockets.
6. **[6] Audio Stream** — Gnani Timbre (text-to-speech) streams audio back to the frontend.

### Layers

- **BACKEND FASTAPI CONTROLLER** — HTTP + WebSocket API layer. Receives audio, calls Gnani STT, drives the Gemini LLM, and coordinates the orchestrator.
- **[unreadable]ENT PIPELINE LAYER** — The STT / LLM / TTS / orchestrator pipeline (partially cut off in the source diagram).
- **GNANI PRISMA** — Speech-to-text model.
- **GNANI TIMBRE** — Text-to-speech model.
- **GNANI EVON ORCHESTRATOR** — Agent reasoning layer (ranked #1 on the BFCL v3 benchmark).
- **EXECUTION TOOLS** — Read / write / run scripts.
- **WORKSPACE SANDBOX** — `sandbox.py` / `js` sandbox for executing generated code.

## Architecture

```text
FRONTEND NEXT.JS WORKBENCH
   ▲
   │  [1] Audio Streams via WebSockets
   │
   │  [5] WebSocket Update (Code Patch + Log Strings)
   │
BACKEND FASTAPI CONTROLLER
   │
   ├───────────────────────────────  [unreadable]ENT PIPELINE LAYER
   │
GNANI PRISMA (Speech-to-Text)          GNANI TIMBRE (Text-to-Speech)
   │                                          ▲
   ▼                                          │
[2] Raw Text                               [6] Audio Stream
   │                                          │
   ▼                                          ▼
GNANI EVON ORCHESTRATOR (Agent Reasoning / #1 BFCL v3)
   │                                          ▲
   │  [3] Function Trigger (Tool Call Intent) │
   │                                          │
   ▼                                          │
[4] Tool Execution Results (Success / Terminal Errors)
   │
   ▼
EXECUTION TOOLS (Read / Write / Run Scripts)
   │
   ▼
WORKSPACE SANDBOX (sandbox.py / js)
```

### Data flow (numbered arrows in the diagram)

1. **[1] Audio Streams via WebSockets** — The Next.js frontend records microphone audio and streams it to the backend over WebSockets.
2. **[2] Raw Text** — Gnani Prisma converts the audio to text.
3. **[3] Function Trigger (Tool Call Intent)** — The Gnani Evon orchestrator interprets the transcript as a function-call / tool-intent request.
4. **[4] Tool Execution Results (Success / Terminal Errors)** — Execution tool results (success or terminal errors) flow back into the orchestrator.
5. **[5] WebSocket Update (Code Patch + Log Strings)** — The backend pushes a code patch and log strings to the frontend over WebSockets.
6. **[6] Audio Stream** — Gnani Timbre (text-to-speech) streams audio back to the frontend.

### Layers

- **BACKEND FASTAPI CONTROLLER** — HTTP + WebSocket API layer. Receives audio, calls Gnani STT, drives the Gemini LLM, and coordinates the orchestrator.
- **[unreadable]ENT PIPELINE LAYER** — The STT / LLM / TTS / orchestrator pipeline (partially cut off in the source diagram).
- **GNANI PRISMA** — Speech-to-text model.
- **GNANI TIMBRE** — Text-to-speech model.
- **GNANI EVON ORCHESTRATOR** — Agent reasoning layer (ranked #1 on the BFCL v3 benchmark).
- **EXECUTION TOOLS** — Read / write / run scripts.
- **WORKSPACE SANDBOX** — `sandbox.py` / `js` sandbox for executing generated code.

## Project structure

```text
.
├── .gitignore                  # Root gitignore (ignores node_modules, .next, .venv, .env, etc.)
├── .idea/                      # IntelliJ IDEA project files
├── backend/
│   ├── main.py                 # FastAPI app: /api/process-voice endpoint
│   ├── requirements.txt        # fastapi, uvicorn, requests, python-dotenv, pydantic, google-genai
│   ├── .env                    # GNANI_API_KEY, GEMINI_API_KEY  (secrets — not committed)
│   └── __pycache__/            # Compiled Python bytecode (ignored)
├── frontend/
│   ├── app/
│   │   ├── page.tsx            # Client UI: microphone + code display
│   │   ├── layout.tsx          # Root layout (Geist sans/mono fonts)
│   │   └── globals.css         # Tailwind 4 + design tokens
│   ├── public/                 # Static assets (SVG icons, favicon)
│   ├── next.config.ts          # Turbopack + tailwind config
│   ├── package.json            # React 19, Next 16.4.5, Tailwind 4
│   ├── package-lock.json
│   ├── tsconfig.json           # strict TypeScript 5 config
│   ├── eslint.config.mjs       # Next.js core-web-vitals + TypeScript
│   ├── AGENTS.md               # Next.js agent rules
│   └── .gitignore              # Frontend gitignore
├── pyproject.toml              # uv-managed backend project (Python >= 3.14)
├── uv.lock                     # uv lockfile
└── .venv/                      # Python virtual environment (ignored)
```

## Getting started

### Backend

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # contains GNANI_API_KEY and GEMINI_API_KEY
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

## Environment variables

| Variable           | Purpose                              |
|--------------------|--------------------------------------|
| `GNANI_API_KEY`    | Gnani API key for STT/TTS calls      |
| `GNANI_TTS_MODEL`  | TTS model (default `timbre-v2.5`)    |
| `GNANI_TTS_VOICE`  | TTS voice (default `Kaveri`)         |
| `GNANI_TTS_LANGUAGE` | TTS language (default `en-IN`)      |
| `GEMINI_API_KEY`   | Google Gemini API key                |
| `GEMINI_MODEL`     | Gemini model (default `gemini-3.1-flash-lite`) |
| `DATABASE_URL`     | Postgres URL (Neon); falls back to local SQLite at `.data/leo.db` when unset |
| `LEO_SESSION_SECRET` | Secret used to sign session cookies |
| `LEO_WORKSPACE_ROOT` | Directory holding per-user workspaces (default `session`) |

## Deployment (Render)

The backend is a **Python** FastAPI service. `render.yaml` declares it as one;
the repo contains no Node backend, so a service configured with the Node
runtime fails at start with `Cannot find module .../backend/dist/server.js`.

If the service already exists, fix it in **Settings**:

| Setting | Value |
|---------|-------|
| Language / Runtime | `Python 3` |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `python -m uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/api/health` |

`python -m uvicorn` is used instead of bare `uvicorn`: it always resolves the
server from the Python that has the dependencies installed, so a service whose
runtime `PATH` does not include the virtualenv's `bin` still starts. Bare
`uvicorn` in that situation fails with `bash: uvicorn: command not found`.

If the service's **Root Directory** is left blank (the repository root), the
dashboard start command must use the root entry point, which forwards to
`backend/main.py`:

```
uvicorn main:app --host 0.0.0.0 --port $PORT
```

The root `pyproject.toml`/`uv.lock` declare `uvicorn[standard]`. Render uses
`uv` whenever a `uv.lock` exists in the service root, so the start command and
the dependency manifest must agree: a build from the repo root installs the
dependencies in `pyproject.toml`, not `backend/requirements.txt`. A missing
`uvicorn` in that manifest is what produces `uvicorn: command not found` even
though the build succeeds.

Deploy a branch that contains this config (the `main` branch may lag behind),
then set `DATABASE_URL` to your Postgres URL. Without it the service starts on
SQLite, which is wiped on every deploy. The `uvicorn[standard]` extra is
required for the `/ws/*` endpoints.

### Keeping the backend awake

Render's free web services sleep after a period without traffic, which makes the
first request slow and leaves the IDE showing "offline" until it wakes. The
`.github/workflows/keep-backend-awake.yml` workflow pings `/api/health` every
ten minutes to keep it warm. It targets
`https://leo-voice-agent-backend.onrender.com/api/health` by default; set a
repository variable `BACKEND_HEALTH_URL` to point it at another deployment.

For a backend that is always active without a keep-alive, upgrade the Render
service to a paid instance type. The IDE also probes `/api/health` every ten
seconds while it is open and reconnects by itself after a restart.

## Smoke test

With the service running (locally or on Render), verify the deployed surface end
to end:

```bash
python scripts/smoke_test.py
python scripts/smoke_test.py --url http://localhost:8000 --timeout 15
```

It checks `/api/health` (status and database), `/openapi.json`, and a
`/ws/process-voice` handshake, then exits non-zero if any check fails. Set
`SMOKE_BASE_URL` to change the default target
(`https://leo-voice-agent.onrender.com`). It needs `requests` and `websockets`,
both of which the backend requirements already install.

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
- [FastAPI Docs](https://fastapi.tiangolo.com)
- [Gnani AI](https://ai.gnani.ai)
