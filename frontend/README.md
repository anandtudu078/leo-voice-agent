# Project Workspace

A dark, desktop-style **code workspace where you build your project by voice**.

Describe what you want — a file, a feature, a fix — and the agent reads, writes,
runs, and ships it for you. The browser is a real code editor: file tree on the
left, a syntax-highlighted editor in the middle, and a voice console below.

## Stack

- **Frontend:** Next.js 16 + React 19, Tailwind CSS 4, TypeScript strict
- **Backend:** FastAPI (WebSocket `/ws/process-voice`, HTTP `/api/process-voice`, `/api/auth/signin`)
- **Pipeline:** Gnani STT → Gemini/Evon orchestrator → sandbox tools (read/write/run) → Gnani TTS

## Run it

```bash
# Terminal 1 — Frontend (http://localhost:3000)
cd frontend
npm install
npm run dev

# Terminal 2 — Backend (http://localhost:8000)
cd backend
pip install -r requirements.txt
cp .env.example .env   # GNANI_API_KEY, GEMINI_API_KEY
uv run main:app --reload --port 8000
```

## Navigation

- `/` — Landing page: project intro + sign in
- `/code` — The code workspace (voice-controlled IDE, requires sign in)
- `/api/auth/signin` — Demo sign-in endpoint (any well-formed email accepted)

## Window layout

- **Header:** `Code Space` + owner email, `Live` badge, `Sign out`
- **Left sidebar:** file tree (open/create/delete), voice command to switch files
- **Middle:** syntax-highlighted code editor with line numbers, `Save` and `Run` buttons
- **Bottom console:** voice transcript + agent logs + agent's spoken reply

## Workspaces & tools

| Tool | Description |
| --- | --- |
| `read_file` | Read a file from the workspace |
| `write_file` | Create / overwrite a file in the workspace |
| `run_script` | Execute a `.py` / `.js` script in an isolated sandbox |

Environment variables are loaded from `.env`:

- `GNANI_API_KEY` — Gemini (LLM) key
- `GNANI_STT_URL` / `GNANI_TTS_URL` — Gnani speech services
- `LEO_WORKSPACE_ROOT` — workspace root for generated code (defaults to `.`)
- `LEO_SESSION_SECRET` — optional session-signing secret (auto-generated if unset)

## Notes

- Auth is **demo**: any well-formed email is accepted, and there is no password
  verification or database. The session is a signed `freebuff_session` cookie that
  the client mirrors into `localStorage`, so the landing page and the code space
  share the same signed-in state.
- The sandbox runs scripts in an isolated workspace rooted at `leo-sandbox`
  (defaults to `tempfile.gettempdir() / "leo-sandbox"`).
