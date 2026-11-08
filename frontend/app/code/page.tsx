'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/app/auth'
import Editor from 'react-simple-code-editor'

/**
 * Code-space IDE.
 *
 * A dark workspace where the developer builds their project by voice.
 *
 *   Header:   "Code Space" + owner email + Live badge + Sign out
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
  const { session, signOut } = useAuthStore()

  if (!session || !session.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b0f19]">
        <div className="text-center">
          <p className="text-white text-lg">Please sign in to open the code space.</p>
          <a
            href="/"
            className="mt-4 inline-block px-5 py-2.5 rounded-md bg-[#635bff] text-white font-medium hover:opacity-90"
          >
            Back to landing
          </a>
        </div>
      </div>
    )
  }

  return <CodeSpaceShell user={session.user} signOut={signOut} />
}

function CodeSpaceShell({ user, signOut }: { user: { email: string }; signOut: () => void }) {
  const [files, setFiles] = useState<{ path: string; kind: 'file' | 'dir'; name: string }[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [transcript, setTranscript] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [connections, setConnections] = useState(0)
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening'>('idle')
  const [recording, setRecording] = useState(false)

  const socketRef = useRef<WebSocket | null>(null)
  socketRef.current = socket

  // ---- Session ----
  // `signOut` is already destructured from the parent; reuse it.

  // ---- File listing: when a file is active, fetch its content from the
  // backend's read_file tool over the voice WebSocket so the IDE reflects
  // the agent's view of the workspace. ----
  useEffect(() => {
    if (!activeFile) return
    if (socketRef.current?.readyState !== WebSocket.OPEN) return
    // Ask the agent to read the file; the backend's orchestrator maps the
    // transcript to a read_file tool call and returns the file content.
    const msg = { type: 'read_file', path: activeFile }
    socketRef.current.send(JSON.stringify(msg))
  }, [activeFile, socketRef])

  // ---- WebSocket connection ----
  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/ws/process-voice`
    const ws = new WebSocket(wsUrl)
    setSocket(ws)
    socketRef.current = ws

    ws.onopen = () => {
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
        }

        switch (msg.type) {
          case 'transcript':
            setTranscript(msg.transcript || '')
            setVoiceStatus('idle')
            break
          case 'code':
            // The agent generated code (from a read/write/run tool).
            setLogs((prev) => [...prev, `{ Agent: ${msg.code || ''} }`])
            if (msg.code && msg.code.includes('FileContent')) {
              // Agent read a file back to us.
              setLogs((prev) => [...prev, `{ Agent read: ${msg.code} }`])
            }
            break
          case 'logs':
            setLogs((prev) => [...prev, ...(msg.logs || [])])
            break
          case 'speech':
            // Agent replied with speech (TTS) — play it aloud.
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
              setLogs((prev) => [...prev, `{ Agent says: ${transcript || '<reply>'} }`])
            } catch {
              // ignore audio decode errors
            }
            break
          case 'error':
            setLogs((prev) => [...prev, `ERROR: ${msg.error || ''}`])
            break
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setConnections((c) => c - 1)
    }

    ws.onerror = () => {
      setConnections((c) => c - 1)
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
    setFiles((prev) => prev.filter((f) => f.path !== path))
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

  // ---- Voice recording ----
  const startRecording = async () => {
    setLoading(true)
    setLogs((prev) => [...prev, `> User spoke (listening...)`])
    setVoiceStatus('listening')
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

  // ---- File tree (static set used as an example workspace; the agent's
  // read/write tools operate on the backend's workspace). We seed it so the
  // IDE has something to show, and the agent keeps the real state. ----
  const [fileTree, setFileTree] = useState<{ path: string; kind: 'file' | 'dir'; name: string }[]>([
    { path: 'main.py', kind: 'file', name: 'main.py' },
    { path: 'app.py', kind: 'file', name: 'app.py' },
    { path: 'README.md', kind: 'file', name: 'README.md' },
    { path: 'sandbox.py', kind: 'file', name: 'sandbox.py' },
  ])

  // Seed a sample file's content when it is first opened.
  useEffect(() => {
    if (activeFile === 'main.py' && !content) {
      setContent(`# Leo voice agent

# Build your project by voice.
# Speak: "open main.py", "read main.py", "write a hello function", "run main.py".

def hello(name=""):
    return f"Hello, {name or 'world'}!"

if __name__ == "__main__":
    print(hello())
`)
    }
  }, [activeFile, content])

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
            <p className="text-xs text-white/50">{user.email} — workspace root</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full text-xs text-white/60">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            live
          </div>
          <button
            onClick={signOut}
            className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ===== Main IDE ===== */}
      <div className="flex-1 flex flex-col gap-3 p-4 md:p-6 overflow-y-auto">
        {/* File browser */}
        <div className="flex gap-3 overflow-x-auto">
          <div className="w-48 flex-shrink-0 border border-white/5 rounded-lg bg-white/[0.03] p-2 flex flex-col gap-1">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-white/40 font-mono">Files</span>
              <button
                className="text-xs text-[#635bff] hover:text-white"
                onClick={() => createFile('new.py')}
              >
                New file
              </button>
            </div>
            {fileTree.map((f) => (
              <div
                key={f.path}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                  activeFile === f.path
                    ? 'bg-[#635bff] text-white'
                    : 'text-white/70 hover:bg-white/5'
                }`}
                onClick={() => openFile(f.path)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {f.kind === 'file' ? <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /> : <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />}
                </svg>
                {f.name}
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
                  onValueChange={(code) => setContent(code)}
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
                  disabled={!activeFile}
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
                <span className="text-xs text-white/30">{transcript || ''}</span>
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
    </main>
  )
}
