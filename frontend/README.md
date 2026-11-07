# Leo Voice Agent

A voice-driven full-stack app: a Next.js (React 19 + Next 16) frontend streams audio over WebSockets to a FastAPI backend, which hands the audio to Gnani STT and runs a Gemini 2.5 Flash code-generation step. The resulting code is displayed in the browser. The architecture is orchestrated by Gnani Evon.

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

## Project layout

```text
.
├── backend/
│   ├── main.py               # FastAPI app: /api/process-voice endpoint
│   ├── requirements.txt      # fastapi, uvicorn, requests, python-dotenv, pydantic, google-genai
│   └── .env                  # GNANI_API_KEY, GEMINI_API_KEY
├── frontend/
│   ├── app/page.tsx          # Client UI: microphone + code display
│   ├── app/layout.tsx        # Root layout (Geist sans/mono fonts)
│   ├── app/globals.css       # Tailwind 4 + design tokens
│   ├── next.config.ts        # Turbopack + tailwind config
│   └── package.json          # React 19, Next 16.4.5, Tailwind 4
└── pyproject.toml            # uv-managed backend project (Python >= 3.14)
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
# Copy .env (contains GNANI_API_KEY and GEMINI_API_KEY)
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
| `GEMINI_API_KEY`   | Google Gemini API key                |

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
- [FastAPI Docs](https://fastapi.tiangolo.com)
