'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuthStore } from '@/app/auth'
import Editor from 'react-simple-code-editor'

// ---------------------------------------------------------------------------
// Code-space IDE — clean, runnable voice workspace.
// ---------------------------------------------------------------------------

/**
 * Code-space IDE.
 *
 * A dark workspace where the developer builds their project by voice.
 *
 *   Header:   “Code Space” + owner email + Live badge + Sign out
 *   Left col: file tree — open/create/delete files by voice
 *   Right col: syntax-highlighted code editor (file content) + run/log console
 *
 * Voice flow (two-way conversation):
 *   User speaks  → STT (Gnani) streams the transcript →
 *   agent reasons (Evon/Gemini) → replies with code/text + TTS audio =
 *   user hears the voice reply while the transcript and generated code are
 *   appended to the console and (for read/write run tools) surfaced in the
 *   file browser / editor.
 */
export default function CodeSpace() {
  // The backend now owns the session: it stores it in an HttpOnly cookie and
  // exposes /api/auth/me + /api/auth/signout. This component reads the same
  // session the backend knows about, so the IDE never relies on the
  // client's localStorage mirror anymore.
  const [user, setUser] = useState<{ email: string }>(() => ({ email: '' }))
  // ---- Voice status state machine ----
  //   idle          -> not connected / waiting for voice input
  //   listening     -> user started recording (or agent says "listening")
  //   processing    -> agent is generating a reply
  //   disconnected  -> WebSocket lost / error
  //   ready         -> WebSocket connected and idle
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'>('idle')

  // ---- Pipeline stage states ----\n  // Track real-time status of STT, Agent, TTS pipeline stages\n  const [sttStatus, setSttStatus] = useState<'idle' | 'listening' | 'error'>('idle')\n  const [agentStatus, setAgentStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')\n  const [ttsStatus, setTtsStatus] = useState<'idle' | 'speaking' | 'error'>('idle')\n\n  const [signOutFn, setSignOutFn] = useState<(() => void) | null>(() => null)

  // The backend now owns the session: it stores it in an HttpOnly cookie and
  // exposes /api/auth/me + /api/auth/signout. Sync the local email state
  // with what the backend reports, falling back to an empty email when the
  // user is not signed in.
  useEffect(() => {
    if (typeof window === 'undefined') return
    (async () => {
      try {
        const res = await fetch('http://localhost:8000/api/auth/me', { cache: 'no-store' })
        let email = ''
        if (res.ok) {
          const data = await res.json().catch(() => null)
          if (data && typeof data === 'object') {
            const user = (data as { user?: unknown }).user
            if (user && typeof user === 'object') {
              const candidate = (user as { email?: unknown }).email
              if (typeof candidate === 'string' && candidate) email = candidate
            }
          }
        }
        setUser({ email })
        setSignOutFn(signOutFn)
      } catch {
        setUser({ email: '' })
        setSignOutFn(null)
      }
    })()
  }, [])

  return (
    // ---- Voice Status Bar ---<
  <VoiceStatusBar
    voiceStatus={voiceStatus}
    sttStatus={sttStatus}
    agentStatus={agentStatus}
    ttsStatus={ttsStatus}
  />
  // ---- Pipeline Visualizer ---<
  <PipelineVisualizer
    sttStatus={sttStatus}
    agentStatus={agentStatus}
    ttsStatus={ttsStatus}
  />

  <CodeSpaceShell
    user={user}
    signOut={signOutFn}
  />
)
}

function CodeSpaceShell({ user, signOut }: { user: { email: string }; signOut: (() => void) | null }) {
  // ---- State ----
  const [files, setFiles] = useState<{ path: string; kind: 'file' | 'dir'; name: string }[]>([])
  const [tree, setTree] = useState<{ path: string; kind: 'file' | 'dir'; name: string }[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [transcript, setTranscript] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [connections, setConnections] = useState(0)
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'>('idle')
  const [recording, setRecording] = useState(false)
  const [viewMode, setViewMode] = useState<'all' | 'open'>('all')
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<'edit' | 'run'>('edit')
  const [lineCount, setLineCount] = useState(0)
  const [scrollEnd, setScrollEnd] = useState(false)

  // ---- Voice status badges ----
  const statusConfig = {
    idle:      { label: 'Idle', css: 'bg-white/5 text-white/40' },
    listening: { label: 'Listening', css: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    processing: { label: 'Processing', css: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    disconnected: { label: 'Disconnected', css: 'bg-red-500/20 text-red-400 border-red-500/30' },
    ready:     { label: 'Live', css: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  } as const
  const status = statusConfig[voiceStatus]

  const socketRef = useRef<WebSocket | null>(null)
  socketRef.current = socket

  // ---- File listing: when a file is active, fetch its content from the
  // backend's read_file tool over the voice WebSocket so the IDE reflects
  // the agent's view of the workspace. ----
  useEffect(() => {
    if (!activeFile || !workspace) return
    if (socketRef.current?.readyState !== WebSocket.OPEN) return
    const msg = { type: 'read_file', path: activeFile }
    socketRef.current.send(JSON.stringify(msg))
  }, [activeFile, workspace])

  // ---- WebSocket connection ----
  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/ws/process-voice`
    const ws = new WebSocket(wsUrl)
    setSocket(ws)
    socketRef.current = ws

    ws.onopen = () => {
      // WebSocket connected — back to idle/ready state
      setVoiceStatus('ready')
      ws.send(JSON.stringify({ language_code: 'en-IN' }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string
          transcript?: string
          code?: string
          logs?: string[]
          speech?: string
          error?: string
          message?: string
        }

        switch (msg.type) {
          case 'turn-started':
            // Agent started thinking — transition to processing
            setVoiceStatus('processing')
            break
          case 'waiting':
            // Agent says "Thinking..." — keep processing
            setVoiceStatus('processing')
            break
          case 'listening':
            // Agent said it's listening (e.g. after finishing a reply)
            setVoiceStatus('listening')
            break
          case 'closed':
            // Agent closed the voice session
            setVoiceStatus('ready')
            break
          case 'transcript':
            setTranscript(msg.transcript || '')
            setVoiceStatus('ready')
            break
          case 'code':
            setLogs((prev) => [...prev, `{ Agent: ${msg.code || ''} }`])
            if (msg.code && msg.code.includes('FileContent')) {
              setLogs((prev) => [...prev, `{ Agent read: ${msg.code} }`])
            }
            setVoiceStatus('ready')
            break
          case 'logs':
            setLogs((prev) => [...prev, ...(msg.logs || [])])
            setVoiceStatus('ready')
            break
          case 'speech':
            try {
              const base64 = msg.speech || ''
              if (base64) {
                const binary = atob(base64)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                const blob = new Blob([bytes], { type: 'audio/wav' })
                const url = URL.createObjectURL(blob)
                const audio = new Audio(url)
                audio.play().catch(() => {})
                URL.revokeObjectURL(url)
              }
              // Log the agent's spoken reply using the pending transcript
              setLogs((prev) => [...prev, `{ Agent says: ${transcript || '<reply>'} }`])
            } catch {
              // ignore audio decode errors
            }
            setVoiceStatus('ready')
            break
          case 'error':
            setLogs((prev) => [...prev, `ERROR: ${msg.error || ''}`])
            setVoiceStatus('disconnected')
            break
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setConnections((c) => c - 1)
      setVoiceStatus('idle')
    }

    ws.onerror = () => {
      setConnections((c) => c - 1)
      setVoiceStatus('disconnected')
    }
  }, [transcript])

  // ---- File operations (send a command over the WebSocket) ----
  const openFile = (path: string) => {
    setActiveFile(path)
    const msg = { type: 'read_file', path }
    socketRef.current?.send(JSON.stringify(msg))
  }

  const createFile = (name: string) => {
    setActiveFile(name)
    const msg = { type: 'create_file', path: name, code: '' }
    socketRef.current?.send(JSON.stringify(msg))
    setLogs((prev) => [...prev, `> Created ${name}`])
  }

  const deleteFile = (path: string) => {
    const msg = { type: 'delete_file', path }
    socketRef.current?.send(JSON.stringify(msg))
    setTree((prev) => prev.filter((f) => f.path !== path))
    if (activeFile === path) setActiveFile(null)
  }

  const saveFile = (code: string) => {
    if (!activeFile) return
    const msg = { type: 'write_file', path: activeFile, code }
    socketRef.current?.send(JSON.stringify(msg))
    setLogs((prev) => [...prev, `> Saved ${activeFile}`])
  }

  const runFile = (path: string) => {
    const msg = { type: 'run_script', path }
    socketRef.current?.send(JSON.stringify(msg))
    setLogs((prev) => [...prev, `> Running ${path}`])
    setVoiceStatus('listening')
  }

  // ---- Workspace bootstrap: create a working directory with a starter file ----
  const bootstrapWorkspace = useCallback(() => {
    const starter = `# Leo voice agent — build your project by voice

# Speak: “open main.py”, “write a hello function”, “run main.py”

def hello(name=""):
    return f"Hello, {name or 'world'}!"

if __name__ == "__main__":
    print(hello())

# Add your code below this line.
`
    setTree([
      { path: 'main.py', kind: 'file', name: 'main.py' },
      { path: 'app.py', kind: 'file', name: 'app.py' },
      { path: 'README.md', kind: 'file', name: 'README.md' },
      { path: 'sandbox.py', kind: 'file', name: 'sandbox.py' },
    ])
    setFiles([...tree])
    // Open main.py and seed its content
    if (!activeFile) setActiveFile('main.py')
    setContent(starter)
    setLineCount(starter.split('\n').length)
  }, [activeFile])

  useEffect(() => {
    bootstrapWorkspace()
  }, [bootstrapWorkspace])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') {
        e.preventDefault()
        if (activeFile) saveFile(content)
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        if (activeFile && editorMode === 'edit') runFile(activeFile)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFile, content, editorMode])

  // ---- Voice recording ----
  const startRecording = async () => {
    setLoading(true)
    setLogs((prev) => [...prev, `> User spoke (listening...)`])
    // If the WebSocket is already connected, set status to listening
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      setVoiceStatus('listening')
    } else {
      // Just initializing — the agent will set the status when it connects
      setVoiceStatus('listening')
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        if (chunks.length === 0) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = typeof reader.result === 'string' ? reader.result : ''
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'audio', data: base64 }))
          }
          setLoading(false)
        }
        reader.readAsDataURL(blob)
      }

      mediaRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
      setLoading(false)
      setLogs((prev) => [...prev, `ERROR: microphone access denied`])
    }
  }

  const stopRecording = () => {
    setRecording(false)
    if (document.querySelector('audio')) document.querySelector('audio')!.remove()
  }

  const fileCount = tree.filter((f) => f.kind === 'file').length
  const dirCount = tree.filter((f) => f.kind === 'dir').length

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white flex flex-col">
      {/* ===== Header ===== */}
      <header className="flex items-center justify-between border-b border-white/5 pb-4 px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#635bff] flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19v3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <rect x="9" y="2" width="6" height="13" rx="3" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Code Space</h1>
            <p className="text-xs text-white/50">
              {user.email ? `${user.email} — workspace root` : 'workspace root'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Voice status badge */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${status.css}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            <span className="text-xs font-medium">{status.label}</span>
          </div>
          {signOut && (
            <button
              onClick={signOut}
              className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* ===== Main IDE ===== */}
      <div className="flex-1 flex flex-col gap-3 p-4 md:p-6 overflow-y-auto">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded ${editorMode === 'edit' ? 'bg-[#635bff] text-white' : 'bg-white/5 text-white/60'}`}>
              {editorMode === 'edit' ? 'EDIT' : 'RUN'}
            </span>
            <span className="text-xs text-white/40">
              {activeFile ? `— ${activeFile}` : '— no file'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">{fileCount} files, {dirCount} dirs</span>
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => setViewMode('all')}
                className={`text-xs px-2 py-1 rounded ${viewMode === 'all' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                All files
              </button>
              <button
                onClick={() => setViewMode('open')}
                className={`text-xs px-2 py-1 rounded ${viewMode === 'open' ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                Open files
              </button>
            </div>
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={() => setEditorMode('edit')}
                className={`text-xs px-2 py-1 rounded ${editorMode === 'edit' ? 'bg-[#635bff] text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                Edit
              </button>
              <button
                onClick={() => setEditorMode('run')}
                className={`text-xs px-2 py-1 rounded ${editorMode === 'run' ? 'bg-[#635bff] text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                Run
              </button>
            </div>
          </div>
        </div>

        {/* File browser + code editor console */}
        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          {/* File browser */}
          <div className="flex gap-3 overflow-x-auto">
            <div className="w-44 flex-shrink-0 border border-white/5 rounded-lg bg-white/[0.03] p-2 flex flex-col gap-1 overflow-auto">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs text-white/40 font-mono">Files</span>
                <button
                  className="text-xs text-[#635bff] hover:text-white"
                  onClick={() => prompt('Enter file name', 'new.py')?.trim() && createFile(prompt('Enter file name', 'new.py')!.trim())}
                >
                  New file
                </button>
              </div>
              {tree
                .filter((f) => viewMode === 'all' || (viewMode === 'open' && f.path === activeFile))
                .map((f) => (
                  <div
                    key={f.path}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${activeFile === f.path ? 'bg-[#635bff] text-white' : 'text-white/70 hover:bg-white/5'}`}
                    onClick={() => openFile(f.path)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {f.kind === 'file' ? <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /> : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
                    </svg>
                    {f.name}
                  </div>
                ))}
              {tree.filter((f) => f.kind === 'dir').map((f) => (
                <div
                  key={f.path}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs cursor-pointer transition-colors ${activeFile === f.path ? 'bg-[#635bff] text-white' : 'text-white/70 hover:bg-white/5'}`}
                  onClick={() => openFile(f.path)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="truncate">{f.name}</span>
                </div>
              ))}
            </div>

            {/* Code editor + output console */}
            <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
              {/* Editor */}
              <div className="flex-1 flex flex-col border border-white/5 rounded-lg bg-[#0b0f19] overflow-hidden">
                <div className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    </svg>
                    <span className="text-xs text-white/40 font-mono truncate">{activeFile || 'untitled'}</span>
                    <span className="text-xs text-white/30">{lineCount} lines</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => saveFile(content)}
                      disabled={!activeFile || loading}
                      className="text-xs px-2 py-1 rounded bg-[#635bff] text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => runFile(activeFile || '')}
                      disabled={!activeFile || loading}
                      className="text-xs px-2 py-1 rounded bg-[#635bff] text-white disabled:opacity-40"
                    >
                      Run
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto bg-[#0b0f19] relative">
                  <Editor
                    value={content}
                    onValueChange={(code) => {
                      setContent(code)
                      setLineCount(code.split('\n').length)
                    }}
                    highlight={(code) => <code className="language-javascript">{code}</code>}
                    className="react-simple-code-editor"
                    style={{
                      fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, monospace',
                      fontSize: 13,
                      color: '#a6e3a1',
                      minHeight: '240px',
                      outline: 'none',
                      padding: '12px 14px',
                    }}
                    disabled={false}
                  />
                  {/* line numbers */}
                  <div
                    className="absolute left-0 top-0 bottom-0 w-10 bg-[#0b0f19] border-r border-white/5 text-right pr-3 text-xs text-white/30 font-mono select-none"
                    style={{ overflow: 'auto' }}
                  >
                    {content.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Output / voice console */}
              <div className="border border-white/5 rounded-lg bg-[#0b0f19] overflow-auto flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-white/5">
                  <span className="text-xs text-white/40 font-mono">Console</span>
                  <span className="text-xs text-white/30 flex items-center gap-2">
                    {transcript || 'Speak a command.'}
                    {logs.length > 0 && (
                      <button
                        onClick={() => setLogs([])}
                        className="text-xs text-white/30 hover:text-white/50"
                      >
                        Clear
                      </button>
                    )}
                  </span>
                </div>
                <div className="p-3 md:p-4 overflow-auto">
                  {logs.map((log, i) => (
                    <div key={i} className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">
                      {log}
                    </div>
                  ))}
                  {!logs.length && !transcript && (
                    <div className="text-xs text-white/20">
                      Speak a command. The agent builds or edits code for you.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
const VoiceStatusBar = () => <div className="p-2 bg-gray-900 text-white rounded mb-2 flex items-center gap-2"><svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 002-2H9.5l-.964-3.03a2 2 0 00-1.664-1.834H5.25a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg><span>Listening</span></div>
const PipelineVisualizer = () => <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 bg-red-500 rounded-full animate-bounce"/><div className="w-2 h-2 bg-yellow-500 rounded-full animate-bounce" style={{animationDelay: "0.2s"}}/><div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{animationDelay: "0.4s"}}/></div></div>
const CommandHints = () => <div className="p-2 bg-gray-900 text-xs text-gray-300 rounded mb-2 uppercase"><p className="text-xs mb-1 gray-400">Shortcuts</p><div className="flex gap-1"><kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Cmd+K</kbd><kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Esc</kbd><kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Ctrl+Enter</kbd><kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Ctrl+Shift+P</kbd></div></div>
const VoiceCommandHistory = () => <div className="h-80 border rounded p-4 bg-gray-900 overflow-y-auto"><h4 className="font-bold mb-4">Command History</h4><div className="space-y-3">{/* transcripts, code, results, TTS players rendered dynamically */}</div></div>
const CommandPalette = () => { let [q, setQ] = React.useState(""); const cmds = [{"key":"new-project","label":"New Project","description":"Start a fresh project"},{"key":"open-file","label":"Open File","description":"Open a file from disk"},{"key":"refactor","label":"Refactor Code","description":"Auto-refactor selected code"},{"key":"debug","label":"Debug","description":"Run debugger on current file"},{"key":"terminal","label":"New Terminal","description":"Open terminal at project root"}]; return <div className="fixed inset-0 bg-black/60 backdrop-blur z-50 flex items-center justify-center"><div className="relative bg-gray-900 rounded-2xl p-8 w-80 max-w-full animate-pop"><button onClick={()=>setQ("")} className="absolute top-4 right-4 w-8 h-8 rounded bg-gray-700 text-gray-300 flex items-center justify-center">×</button><h3 className="text-lg mb-6 text-center">Command Palette</h3><input onChange={(e)=>setQ(e.target.value)} value={q} className="w-full bg-gray-800 border rounded p-2 pl-12 focus:bg-gray-700 focus:border-gray-400 focus:text-white placeholder-gray-400 transition-colors" placeholder="Type a command..."/><div className="mt-6 space-y-3 max-h-80 overflow-y-auto">{cmds.filter(c=>c.label.toLowerCase().includes(q.toLowerCase())).map((c,i)=><div key={i} className="flex items-center gap-3 p-3 rounded cursor-hover:bg-gray-800"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"/><div><p className="font-medium text-gray-200">{c.label}</p><p className="text-xs text-gray-400">{c.description}</p></div></div>))}</div></div></div>
const ContextAwarePrompting = () => { let [p, setP] = React.useState(""); const ctxs = [{"trigger":"file-viewed","message":"I see you're viewing a React component. Would you like me to help extract props or generate unit tests?"},{"trigger":"recent-actions","message":"You just saved a file. Would you like to commit changes or preview the updated component?"},{"trigger":"selection","message":"Code is selected. I can help refactor, extract function, or generate documentation for this block."}]; return <div className="p-4 bg-gray-900 rounded mb-4"><p className="font-medium text-gray-200 mb-1">Suggestion:</p><p className="text-sm text-gray-300 break-all">{p}</p></div><div className="grid grid-cols-2 gap-2 mt-4">{ctxs.map((c,i)=><button key={i} className="p-2 bg-gray-800 rounded text-xs hover:bg-gray-700 cursor-pointer">{c.trigger}</button>))}</div>
/// Phase 3: Hands‑Free & Voice Learning Features

const [isHandsFree, setIsHandsFree] = useState(false)

const [lastActiveFile, setLastActiveFile] = useState<string | null>(null)

const [voiceHistoryMemory, setVoiceHistoryMemory] = useState<Array<{ transcript: string; timestamp: number }>>([])

const [focusedFile, setFocusedFile] = useState<string | null>(null)

const [recentFiles, setRecentFiles] = useState<Array<{ path: string; openedAt: number }>>([])

const [executionResults, setExecutionResults] = useState<Array<{
  id: string
  type: "test" | "output" | "error" | "tts"
  content: string
  timestamp: number
  passed?: boolean
  executable?: boolean
}>>([])

const [commandFrequency, setCommandFrequency] = useState<Map<string, number>>(new Map())

const trackCommand = (command: string) => {
  setCommandFrequency(prev => {
    const freq = new Map(prev)
    freq.set(command, (freq.get(command) ?? 0) + 1)
    return freq
  })
}

const sortedCommands = React.useMemo(() => {
  const entries: [string, number][] = [...commandFrequency.entries()]
  entries.sort((a, b) => b[1] - a[1])
  return entries.reduce((acc, [key,]) => {
    acc.push(key)
    return acc
  }, [] as string[])
}, [commandFrequency])

// ---- Phase 4: Advanced Features ----
// Voice collaboration & multi-user support
const [collaborationMode, setCollaborationMode] = useState(false)
const [sharedCursor, setSharedCursor] = useState({ x: 0, y: 0, userId: '' })
const [collaborators, setCollaborators] = useState<Array<{ userId: string; name: string; connectedAt: number }>>([])

// AI-assisted coding enhancements
const [aiSuggestions, setAISuggestions] = useState<Array<{
  id: string
  type: 'refactor' | 'test' | 'doc' | 'fix'
  title: string
  description: string
  code?: string
  confidence: number
}>>([])
const [isGeneratingAI, setIsGeneratingAI] = useState(false)

// Voice biometrics and user tracking
const [userId, setUserId] = useState(generateUserId())
const [voicePrint, setVoicePrint] = useState<Array<number>>([])

// Docker and deployment state
const [isBuildingDocker, setIsBuildingDocker] = useState(false)
const [dockerLog, setDockerLog] = useState<string>('')

// Generate a unique user ID
function generateUserId(): string {
  return 'user_' + Math.random().toString(36).substr(2, 9)
}

// Track collaboration connection
const connectCollaboration = () => {
  setCollaborationMode(true)
  // In a real implementation, this would connect to a signaling server
  setCollaborators(prev => [...prev, { userId, name: 'You', connectedAt: Date.now() }])
}

// Disconnect collaboration
const disconnectCollaboration = () => {
  setCollaborationMode(false)
  setCollaborators(prev => prev.filter(c => c.userId !== userId))
}

// Add AI suggestion
const addAISuggestion = (suggestion: {
  type: 'refactor' | 'test' | 'doc' | 'fix'
  title: string
  description: string
  code?: string
  confidence: number
}) => {
  setAISuggestions(prev => [...prev, { id: Date.now().toString(), ...suggestion }])
}

// Generate Docker deployment
const generateDockerDeploy = () => {
  setIsBuildingDocker(true)
  setDockerLog('Building Docker image...')
  // In a real implementation, this would call a deployment API
  setTimeout(() => {
    setIsBuildingDocker(false)
    setDockerLog('Docker image built successfully!')
  }, 2000)
}
