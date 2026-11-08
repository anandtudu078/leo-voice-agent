'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

import { ActivityBar } from './ActivityBar'
import { SideBar } from './SideBar'
import { EditorArea } from './EditorArea'
import { Panel } from './Panel'
import { StatusBar } from './StatusBar'
import { VoiceStatus } from './VoiceStatus'

// ---------------------------------------------------------------------------
// Code-space IDE � VS Code / PyCharm style shell, voice-powered.
// ---------------------------------------------------------------------------
// Layout blueprint:
//
//   TitleBar (top)
//   +- ActivityBar (far-left rail)
//   +- SideBar (collapsible explorer) | EditorArea (tabs + editor) | Panel (bottom)
//   +- StatusBar (bottom)
// ---------------------------------------------------------------------------

export default function CodeSpace() {
  const [user, setUser] = useState<{ email: string }>({ email: '' })

  // Voice status state machine
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'>('idle')

  // Pipeline stage states
  const [sttStatus, setSttStatus] = useState<'idle' | 'listening' | 'error'>('idle')
  const [agentStatus, setAgentStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'speaking' | 'error'>('idle')

  const [signOutFn, setSignOutFn] = useState<(() => void) | null>(() => null)

  // Sync session email with backend
  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' })
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

  const status = useMemo(() => {
    const map: Record<string, { label: string; css: string }> = {
      idle: { label: 'Idle', css: 'bg-white/10 text-white/60' },
      listening: { label: 'Listening', css: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      processing: { label: 'Processing', css: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
      disconnected: { label: 'Disconnected', css: 'bg-red-500/20 text-red-400 border-red-500/30' },
      ready: { label: 'Live', css: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    }
    return map[voiceStatus] || map.idle
  }, [voiceStatus])

  return (
    <>
      <CodeSpaceShell
        user={user}
        signOut={signOutFn}
        voiceStatus={voiceStatus}
        setVoiceStatus={setVoiceStatus}
        sttStatus={sttStatus}
        setSttStatus={setSttStatus}
        agentStatus={agentStatus}
        setAgentStatus={setAgentStatus}
        ttsStatus={ttsStatus}
        setTtsStatus={setTtsStatus}
      />
    </>
  )
}
// ---------------------------------------------------------------------------
// IDE shell: holds all workspace/editor/voice state and renders the chrome.
// ---------------------------------------------------------------------------

type StarterFile = { path: string; kind: 'file' | 'dir'; name: string }

const STARTER_FILES: StarterFile[] = [
  { path: 'main.py', kind: 'file', name: 'main.py' },
  { path: 'app.py', kind: 'file', name: 'app.py' },
  { path: 'README.md', kind: 'file', name: 'README.md' },
  { path: 'sandbox.py', kind: 'file', name: 'sandbox.py' },
]

const starterFiles = () => STARTER_FILES.map((file) => ({ ...file }))

const STARTER_CODE = `# Leo voice agent - build your project by voice

# Speak: "open main.py", "write a hello function", "run main.py"

def hello(name=""):
    return f"Hello, {name or 'world'}!"

if __name__ == "__main__":
    print(hello())

# Add your code below this line.
`

function CodeSpaceShell({
  user,
  signOut,
  voiceStatus,
  setVoiceStatus,
  sttStatus,
  setSttStatus,
  agentStatus,
  setAgentStatus,
  ttsStatus,
  setTtsStatus,
}: {
  user: { email: string }
  signOut: (() => void) | null
  voiceStatus: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'
  setVoiceStatus: (status: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready') => void
  sttStatus: 'idle' | 'listening' | 'error'
  setSttStatus: (s: 'idle' | 'listening' | 'error') => void
  agentStatus: 'idle' | 'processing' | 'done' | 'error'
  setAgentStatus: (s: 'idle' | 'processing' | 'done' | 'error') => void
  ttsStatus: 'idle' | 'speaking' | 'error'
  setTtsStatus: (s: 'idle' | 'speaking' | 'error') => void
}) {
  // ---- Workspace state ----
  // Seeded from the constants above rather than a bootstrap effect: calling
  // setState synchronously inside an effect causes cascading renders
  // (eslint react-hooks/set-state-in-effect).
  const [files, setFiles] = useState<StarterFile[]>(starterFiles)
  const [tree, setTree] = useState<StarterFile[]>(starterFiles)
  const [activeFile, setActiveFile] = useState<string | null>('main.py')
  const [content, setContent] = useState(STARTER_CODE)
  const [transcript, setTranscript] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [connections, setConnections] = useState(0)
  const [recording, setRecording] = useState(false)
  const [viewMode, setViewMode] = useState<'all' | 'open'>('all')
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<'edit' | 'run'>('edit')
  const [lineCount, setLineCount] = useState(() => STARTER_CODE.split('\n').length)
  const [scrollEnd, setScrollEnd] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeView, setActiveView] = useState('explorer')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSuggestion, setShowSuggestion] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'terminal' | 'output' | 'problems' | 'voice'>('output')
  const [activeTab, setActiveTab] = useState<string | null>('main.py')
  const [openTabs, setOpenTabs] = useState<{ path: string; label: string }[]>([
    { path: 'main.py', label: 'main.py' },
  ])

  // ---- Phase 3: hands-free & voice learning ----
  const [isHandsFree, setIsHandsFree] = useState(false)
  const [lastActiveFile, setLastActiveFile] = useState<string | null>(null)
  const [voiceHistoryMemory, setVoiceHistoryMemory] = useState<Array<{ transcript: string; timestamp: number }>>([])
  const [focusedFile, setFocusedFile] = useState<string | null>(null)
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; openedAt: number }>>([])
  const [executionResults, setExecutionResults] = useState<
    Array<{
      id: string
      type: 'test' | 'output' | 'error' | 'tts'
      content: string
      timestamp: number
      passed?: boolean
      executable?: boolean
    }>
  >([])
  const [commandFrequency, setCommandFrequency] = useState<Map<string, number>>(new Map())

  const trackCommand = (command: string) => {
    setCommandFrequency((prev) => {
      const next = new Map(prev)
      next.set(command, (next.get(command) || 0) + 1)
      return next
    })
  }

  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // ---- Voice status badge config ----
  const statusBadge = useMemo(() => {
    const map: Record<string, { label: string; css: string }> = {
      idle: { label: 'Idle', css: 'bg-white/10 text-white/60 border-white/10' },
      listening: { label: 'Listening', css: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      processing: { label: 'Processing', css: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
      disconnected: { label: 'Disconnected', css: 'bg-red-500/20 text-red-400 border-red-500/30' },
      ready: { label: 'Live', css: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    }
    return map[voiceStatus] || map.idle
  }, [voiceStatus])

  // ---- WebSocket connection ----
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
    const wsUrl = `${backendUrl.replace(/^http/, 'ws')}/ws/process-voice`
    const ws = new WebSocket(wsUrl)
    socketRef.current = ws
    setSocket(ws)
    setConnections((c) => c + 1)

    ws.onopen = () => setVoiceStatus('ready')
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'status':
            switch (msg.status) {
              case 'connected':
                setVoiceStatus('ready')
                break
              case 'processing':
                setVoiceStatus('processing')
                setAgentStatus('processing')
                break
              case 'listening':
                setVoiceStatus('listening')
                setSttStatus('listening')
                break
              case 'closed':
                setVoiceStatus('ready')
                break
            }
            break
          case 'ready':
            setVoiceStatus('ready')
            if (Array.isArray(msg.files)) {
              setFiles(msg.files)
              setTree(msg.files)
              if (msg.files.length === 0) {
                // The starter tree is seeded on the client. Persist it so
                // opening one of those files doesn't hit "File not found".
                for (const file of STARTER_FILES) {
                  if (file.kind !== 'file') continue
                  socketRef.current?.send(
                    JSON.stringify({
                      type: 'write_file',
                      path: file.path,
                      code: file.path === 'main.py' ? STARTER_CODE : '',
                    }),
                  )
                }
              }
            }
            break
          case 'turn-started':
            setVoiceStatus('processing')
            setAgentStatus('processing')
            break
          case 'waiting':
            setVoiceStatus('processing')
            break
          case 'listening':
            setVoiceStatus('ready')
            setSttStatus('idle')
            setAgentStatus('done')
            setTtsStatus('idle')
            break
          case 'file':
            if (typeof msg.path === 'string') {
              const filePath = msg.path
              setActiveFile(filePath)
              setActiveTab(filePath)
              setOpenTabs((prev) =>
                prev.some((tab) => tab.path === filePath)
                  ? prev
                  : [
                      ...prev,
                      { path: filePath, label: filePath.split('/').pop() || filePath },
                    ],
              )
              const fileContent = typeof msg.content === 'string' ? msg.content : ''
              setContent(fileContent)
              setLineCount(fileContent.split('\n').length)
            }
            break
          case 'transcript':
            setTranscript(msg.transcript || '')
            setVoiceStatus('ready')
            setSttStatus('idle')
            break
          case 'code':
            setLogs((prev) => [...prev, `{ Agent: ${msg.code || ''} }`])
            if (msg.code && msg.code.includes('FileContent')) {
              setLogs((prev) => [...prev, `{ Agent read: ${msg.code} }`])
            }
            setVoiceStatus('ready')
            setAgentStatus('done')
            break
          case 'logs':
            setLogs((prev) => [...prev, ...(msg.logs || [])])
            if (Array.isArray(msg.files)) {
              setFiles(msg.files)
              setTree(msg.files)
            }
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
              setLogs((prev) => [...prev, `{ Agent says: ${msg.text || '<reply>'} }`])
            } catch {
              // ignore audio decode errors
            }
            setVoiceStatus('ready')
            setAgentStatus('done')
            setTtsStatus('idle')
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
    // State setters are stable, so this effect connects once instead of
    // reconnecting every time the voice status or transcript changes.
  }, [setVoiceStatus, setSttStatus, setAgentStatus, setTtsStatus])

  useEffect(() => {
    connect()
    return () => {
      socketRef.current?.close()
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [connect])
  // ---- File operations ----
  const openFile = (path: string) => {
    setActiveFile(path)
    setActiveTab(path)
    if (!openTabs.some((t) => t.path === path)) {
      setOpenTabs((prev) => [...prev, { path, label: path.split('/').pop() || path }])
    }
    setRecentFiles((prev) => {
      const next = prev.filter((f) => f.path !== path)
      return [{ path, openedAt: Date.now() }, ...next].slice(0, 10)
    })
    const msg = { type: 'read_file', path }
    socketRef.current?.send(JSON.stringify(msg))
  }

  const createFile = (name: string) => {
    setActiveFile(name)
    setActiveTab(name)
    if (!openTabs.some((t) => t.path === name)) {
      setOpenTabs((prev) => [...prev, { path: name, label: name.split('/').pop() || name }])
    }
    const msg = { type: 'create_file', path: name, code: '' }
    socketRef.current?.send(JSON.stringify(msg))
    setLogs((prev) => [...prev, `> Created ${name}`])
  }

  const deleteFile = (path: string) => {
    const msg = { type: 'delete_file', path }
    socketRef.current?.send(JSON.stringify(msg))
    setTree((prev) => prev.filter((f) => f.path !== path))
    setFiles((prev) => prev.filter((f) => f.path !== path))
    setOpenTabs((prev) => prev.filter((t) => t.path !== path))
    if (activeFile === path) setActiveFile(null)
    if (activeTab === path) setActiveTab(null)
  }

  const saveFile = (code: string) => {
    if (!activeFile) return
    const msg = { type: 'write_file', path: activeFile, code }
    socketRef.current?.send(JSON.stringify(msg))
    setLogs((prev) => [...prev, `> Saved ${activeFile}`])
  }

  const runFile = (path: string) => {
    if (!content) return
    const scriptPath = path || 'snippet.py'
    socketRef.current?.send(JSON.stringify({
      type: 'write_file',
      path: scriptPath,
      code: content,
    }))
    setLogs((prev) => [...prev, `> Saved ${scriptPath}`])
    socketRef.current?.send(JSON.stringify({
      type: 'run_script',
      path: scriptPath,
    }))
    setLogs((prev) => [...prev, `> Running ${scriptPath}`])
    setVoiceStatus('listening')
  }

  const closeTab = (path: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.path !== path))
    if (activeTab === path) {
      const remaining = openTabs.filter((t) => t.path !== path)
      setActiveTab(remaining.length > 0 ? remaining[0].path : null)
      setActiveFile(remaining.length > 0 ? remaining[0].path : null)
    }
  }

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
      if (mod && e.key === 'j') {
        e.preventDefault()
        setPanelOpen(!panelOpen)
      }
      if (mod && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFile, content, editorMode, panelOpen, paletteOpen])

  // ---- Voice recording ----
  const startRecording = async () => {
    if (recording || !navigator.mediaDevices?.getUserMedia) return
    setLoading(true)
    setLogs((prev) => [...prev, '> Listening… speak, then press Stop'])
    setVoiceStatus('listening')
    setSttStatus('listening')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      const chunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        setRecording(false)
        setLoading(false)

        if (chunks.length === 0) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const base64 = typeof reader.result === 'string' ? reader.result : ''
          if (base64 && socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: 'audio', data: base64 }))
          } else {
            setLogs((prev) => [...prev, 'ERROR: voice socket is not connected'])
            setVoiceStatus('disconnected')
          }
        }
        reader.readAsDataURL(blob)
      }

      recorderRef.current = mediaRecorder
      streamRef.current = stream
      mediaRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
      setLoading(false)
      setRecording(false)
      setLogs((prev) => [...prev, 'ERROR: microphone access denied'])
      setVoiceStatus('disconnected')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      setRecording(false)
      setLoading(false)
    }
  }

  const toggleRecording = () => {
    if (recording) stopRecording()
    else void startRecording()
  }

  const fileCount = tree.filter((f) => f.kind === 'file').length
  const dirCount = tree.filter((f) => f.kind === 'dir').length
  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-[#1e1e1e] text-white">
      {/* ===== Title bar ===== */}
      <header className="ide-titlebar flex items-center justify-between gap-3 px-3 h-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded bg-[#635bff] flex items-center justify-center shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19v3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <rect x="9" y="2" width="6" height="13" rx="3" />
            </svg>
          </div>
          <span className="text-xs font-semibold tracking-tight truncate">Leo Voice Workspace</span>
          <span className="hidden md:inline text-[11px] text-white/30 truncate max-w-56">
            {activeFile || 'no file open'} · {fileCount} files{dirCount ? `, ${dirCount} folders` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <PipelineVisualizer
            sttStatus={sttStatus}
            agentStatus={agentStatus}
            ttsStatus={ttsStatus}
          />
          <VoiceStatus voiceStatus={voiceStatus} />
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors ${
              recording
                ? 'bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30'
                : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
            title={recording ? 'Stop and send the command' : 'Record a voice command'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
            {recording ? 'Stop & send' : 'Speak'}
          </button>
          <button
            onClick={() => setIsHandsFree((value) => !value)}
            className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors ${
              isHandsFree
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
            }`}
            title="Toggle hands-free listening"
          >
            Hands-free
          </button>
          {user.email && (
            <span className="hidden lg:inline text-[11px] text-white/40 truncate max-w-40" title={user.email}>
              {user.email}
            </span>
          )}
          {signOut && (
            <button
              onClick={signOut}
              className="text-xs px-2.5 py-1 rounded bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      {/* ===== Workbench ===== */}
      <div className="flex flex-1 min-h-0 min-w-0">
        <ActivityBar
          active={activeView}
          onSelect={(id) => {
            setActiveView(id)
            setSidebarOpen(true)
          }}
        />

        {sidebarOpen && (
          <SideBar
            files={files}
            activeFile={activeFile}
            onOpenFile={openFile}
            onCreateFile={() => createFile('untitled')}
            view={activeView}
            onToggle={() => setSidebarOpen(false)}
            onSelectView={setActiveView}
          />
        )}

        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <EditorArea
            tabs={openTabs}
            activeTab={activeTab}
            content={content}
            onContentChange={(code) => {
              setContent(code)
              setLineCount(code.split('\n').length)
            }}
            onSave={() => saveFile(content)}
            onRun={() => runFile(activeFile || '')}
            onTabClick={openFile}
            onTabClose={closeTab}
            disabled={editorMode === 'run'}
          />

          <Panel
            open={panelOpen}
            onToggle={() => setPanelOpen((open) => !open)}
            activeTab={panelTab}
            onTabChange={(id: string) =>
              setPanelTab(id as 'voice' | 'terminal' | 'output' | 'problems')
            }
          >
            {panelTab === 'output' && (
              <div className="flex flex-col h-full min-h-0 gap-1">
                <div className="text-[11px] uppercase tracking-wider text-white/35 shrink-0">
                  Output
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto font-mono text-xs space-y-0.5">
                  {transcript && (
                    <div className="text-[#8b83ff] whitespace-pre-wrap">&gt; {transcript}</div>
                  )}
                  {logs.map((log, i) => (
                    <div key={i} className="text-white/60 leading-relaxed whitespace-pre-wrap">
                      {log}
                    </div>
                  ))}
                  {!logs.length && !transcript && (
                    <div className="text-white/25">
                      Press Speak, say a command, then press Stop &amp; send. Agent output and
                      errors appear here.
                    </div>
                  )}
                </div>
              </div>
            )}

            {panelTab === 'terminal' && (
              <div className="flex flex-col h-full min-h-0 font-mono text-xs">
                <div className="text-white/40 shrink-0">Leo sandbox terminal</div>
                <div className="flex-1 min-h-0 overflow-y-auto text-white/55 space-y-0.5 mt-1">
                  {logs.map((log, i) => (
                    <div key={i} className="whitespace-pre-wrap">
                      {log}
                    </div>
                  ))}
                  {!logs.length && (
                    <div className="text-white/25">$ Run a file to see its output here.</div>
                  )}
                </div>
              </div>
            )}

            {panelTab === 'problems' && (
              <div className="h-full font-mono text-xs">
                <div className="text-white/40 mb-1">Problems</div>
                <div className="text-white/25">No problems detected.</div>
              </div>
            )}

            {panelTab === 'voice' && (
              <div className="h-full space-y-3">
                <div>
                  <div className="text-[11px] text-white/35 mb-1 font-semibold uppercase tracking-wider">
                    Voice state
                  </div>
                  <VoiceStatus voiceStatus={voiceStatus} />
                </div>
                <div>
                  <div className="text-[11px] text-white/35 mb-1 font-semibold uppercase tracking-wider">
                    Pipeline
                  </div>
                  <PipelineVisualizer
                    sttStatus={sttStatus}
                    agentStatus={agentStatus}
                    ttsStatus={ttsStatus}
                  />
                </div>
                <div>
                  <div className="text-[11px] text-white/35 mb-1 font-semibold uppercase tracking-wider">
                    Last transcript
                  </div>
                  <div className="text-xs text-white/60 whitespace-pre-wrap">
                    {transcript || 'Nothing heard yet.'}
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </section>
      </div>

      {/* ===== Status bar ===== */}
      <StatusBar
        voiceStatus={voiceStatus}
        branch="main"
        encoding="UTF-8"
        lineCol={`Ln ${lineCount}, Col 1`}
        recording={recording}
        onVoiceToggle={toggleRecording}
      />

      {showSuggestion && <ContextAwarePrompting onClose={() => setShowSuggestion(false)} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </main>
  )
}

// ---------------------------------------------------------------------------
// Voice status indicators (kept from original, restyled for IDE)
// ---------------------------------------------------------------------------

const VOICE_STATUS_LABELS = {
  idle: 'Idle',
  listening: 'Listening',
  processing: 'Processing',
  disconnected: 'Disconnected',
  ready: 'Live',
} as const

function VoiceStatusBar({
  voiceStatus,
  className,
}: { voiceStatus: keyof typeof VOICE_STATUS_LABELS; className?: string }) {
  return (
    <div className={`p-2 bg-gray-900 text-white rounded mb-2 flex items-center gap-2 ${className || ''}`}>
      <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 002-2H9.5l-.964-3.03a2 2 0 00-1.664-1.834H5.25a2 2 0 00-2 2v6a2 2 0 002 2z"
        />
      </svg>
      <span>{VOICE_STATUS_LABELS[voiceStatus]}</span>
    </div>
  )
}

function PipelineVisualizer({
  sttStatus,
  agentStatus,
  ttsStatus,
  className,
}: {
  sttStatus: 'idle' | 'listening' | 'error'
  agentStatus: 'idle' | 'processing' | 'done' | 'error'
  ttsStatus: 'idle' | 'speaking' | 'error'
  className?: string
}) {
  const stages = [
    { label: 'STT', active: sttStatus === 'listening', color: 'bg-blue-500' },
    { label: 'Agent', active: agentStatus === 'processing', color: 'bg-amber-500' },
    { label: 'TTS', active: ttsStatus === 'speaking', color: 'bg-emerald-500' },
  ]

  return (
    <div className={`flex items-center gap-3 px-1 ${className || ''}`}>
      {stages.map((stage) => (
        <div key={stage.label} className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${stage.active ? `${stage.color} animate-bounce` : 'bg-white/15'}`}
          />
          <span className="text-xs text-white/40">{stage.label}</span>
        </div>
      ))}
    </div>
  )
}

function CommandHints() {
  return (
    <div className="p-2 bg-gray-900 text-xs text-gray-300 rounded mb-2 uppercase">
      <p className="text-xs mb-1 text-gray-400">Shortcuts</p>
      <div className="flex gap-1">
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Cmd+K</kbd>
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Esc</kbd>
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Ctrl+Enter</kbd>
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">Ctrl+J</kbd>
      </div>
    </div>
  )
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')

  if (!open) return null
  const cmds = [
    { key: 'new-project', label: 'New Project', description: 'Start a fresh project' },
    { key: 'open-file', label: 'Open File', description: 'Open a file from disk' },
    { key: 'refactor', label: 'Refactor Code', description: 'Auto-refactor selected code' },
    { key: 'debug', label: 'Debug', description: 'Run debugger on current file' },
    { key: 'terminal', label: 'New Terminal', description: 'Open terminal at project root' },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur z-50 flex items-center justify-center">
      <div className="relative bg-[#1e1e1e] rounded-2xl p-8 w-80 max-w-full animate-pop border border-white/10">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded bg-white/10 text-white/50 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors"
        >
          �
        </button>
        <h3 className="text-lg mb-6 text-center text-white">Command Palette</h3>
        <input
          onChange={(e) => setQ(e.target.value)}
          value={q}
          className="w-full bg-[#252526] border border-white/10 rounded p-2 pl-12 focus:bg-[#3c3c3c] focus:border-[#635bff] focus:text-white placeholder-white/30 transition-colors"
          placeholder="Type a command..."
        />
        <div className="mt-6 space-y-3 max-h-80 overflow-y-auto">
          {cmds
            .filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))
            .map((c) => (
              <div key={c.key} className="flex items-center gap-3 p-3 rounded hover:bg-white/5 cursor-pointer transition-colors">
                <span className="w-1.5 h-1.5 bg-[#635bff] rounded-full animate-pulse" />
                <div>
                  <p className="font-medium text-white">{c.label}</p>
                  <p className="text-xs text-white/40">{c.description}</p>
                </div>
              </div>
            ))}
        </div>
        <CommandHints />
      </div>
    </div>
  )
}

function ContextAwarePrompting({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState('')
  const contexts = [
    {
      trigger: 'file-viewed',
      message: "I see you're viewing a React component. Would you like me to help extract props or generate unit tests?",
    },
    {
      trigger: 'recent-actions',
      message: 'You just saved a file. Would you like to commit changes or preview the updated component?',
    },
    {
      trigger: 'selection',
      message: 'Code is selected. I can help refactor, extract function, or generate documentation for this block.',
    },
  ]

  return (
    <aside className="fixed bottom-10 right-3 z-20 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-white/10 bg-[#252526] shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
          Suggestion
        </span>
        <button
          onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center text-white/40 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Dismiss suggestion"
        >
          ×
        </button>
      </div>
      <p className="px-3 py-2 text-xs leading-relaxed text-white/60">{prompt || contexts[0].message}</p>
      <div className="flex flex-wrap gap-1.5 border-t border-white/5 px-3 py-2">
        {contexts.map((c) => (
          <button
            key={c.trigger}
            onClick={() => setPrompt(c.message)}
            className="px-2 py-1 rounded bg-white/5 text-[11px] text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            {c.trigger}
          </button>
        ))}
      </div>
    </aside>
  )
}
