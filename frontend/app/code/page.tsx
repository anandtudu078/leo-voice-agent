'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

import { ActivityBar } from './ActivityBar'
import { SideBar } from './SideBar'
import { EditorArea } from './EditorArea'
import { Panel } from './Panel'
import { StatusBar } from './StatusBar'
import { VoiceStatus } from './VoiceStatus'
import { languageLabel } from '@/lib/highlight'
import {
  baseName,
  listWorkspace,
  makeWorkspaceDir,
  readWorkspaceFile,
  removeWorkspacePath,
  renameWorkspacePath,
  runWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceEntry,
} from '@/lib/workspace'

type EditorTab = { path: string; content: string; saved: string }

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isWithin(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

function movePath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

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
      } catch {
        setUser({ email: '' })
      }
    })()
  }, [])

  return (
    <>
      <CodeSpaceShell
        user={user}
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

function CodeSpaceShell({
  user,
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
  voiceStatus: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'
  setVoiceStatus: (status: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready') => void
  sttStatus: 'idle' | 'listening' | 'error'
  setSttStatus: (s: 'idle' | 'listening' | 'error') => void
  agentStatus: 'idle' | 'processing' | 'done' | 'error'
  setAgentStatus: (s: 'idle' | 'processing' | 'done' | 'error') => void
  ttsStatus: 'idle' | 'speaking' | 'error'
  setTtsStatus: (s: 'idle' | 'speaking' | 'error') => void
}) {
  // ---- Workspace state (server-backed) ----
  const [files, setFiles] = useState<WorkspaceEntry[]>([])
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [loadingTree, setLoadingTree] = useState(true)
  const [offline, setOffline] = useState(false)
  const [runningPath, setRunningPath] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeView, setActiveView] = useState('explorer')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSuggestion, setShowSuggestion] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'terminal' | 'output' | 'problems' | 'voice'>('output')

  const activeTab = activeFile
  const activeContent = tabs.find((tab) => tab.path === activeFile)?.content ?? ''
  const openTabs = tabs.map((tab) => ({
    path: tab.path,
    label: baseName(tab.path),
    dirty: tab.content !== tab.saved,
  }))
  const dirtyPaths = tabs
    .filter((tab) => tab.content !== tab.saved)
    .map((tab) => tab.path)

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

  // ---- Helpers shared by the HTTP file API and the voice socket ----
  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-499), line])
  }, [])

  const adoptFile = useCallback((path: string, content: string) => {
    setTabs((prev) =>
      prev.some((tab) => tab.path === path)
        ? prev.map((tab) => (tab.path === path ? { ...tab, content, saved: content } : tab))
        : [...prev, { path, content, saved: content }],
    )
    setActiveFile(path)
    setCursor({ line: 1, col: 1 })
  }, [])

  const refreshTree = useCallback(async () => {
    try {
      setFiles(await listWorkspace())
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void listWorkspace()
      .then((entries) => {
        if (cancelled) return
        setFiles(entries)
        setOffline(false)
      })
      .catch(() => {
        if (!cancelled) setOffline(true)
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ---- WebSocket connection ----
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'
    const wsUrl = `${backendUrl.replace(/^http/, 'ws')}/ws/process-voice`
    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

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
            if (Array.isArray(msg.files)) setFiles(msg.files)
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
            if (typeof msg.path === 'string' && msg.path) {
              adoptFile(msg.path, typeof msg.content === 'string' ? msg.content : '')
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
            if (Array.isArray(msg.files)) setFiles(msg.files)
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
      setVoiceStatus('idle')
    }

    ws.onerror = () => {
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
  // ---- File operations (HTTP workspace API) ----
  const openFile = async (path: string) => {
    if (tabs.some((tab) => tab.path === path)) {
      setActiveFile(path)
      return
    }
    try {
      const fileContent = await readWorkspaceFile(path)
      setOffline(false)
      setTabs((prev) =>
        prev.some((tab) => tab.path === path)
          ? prev
          : [...prev, { path, content: fileContent, saved: fileContent }],
      )
      setActiveFile(path)
      setCursor({ line: 1, col: 1 })
    } catch (err) {
      pushLog(`ERROR: cannot open ${path} — ${describeError(err)}`)
    }
  }

  const createFile = async (dir = '') => {
    const suggested = dir ? `${dir}/untitled.py` : 'untitled.py'
    const path = window.prompt('New file path', suggested)?.trim()
    if (!path) return
    try {
      setFiles(await writeWorkspaceFile(path, ''))
      setOffline(false)
      pushLog(`> Created ${path}`)
      await openFile(path)
    } catch (err) {
      pushLog(`ERROR: could not create ${path} — ${describeError(err)}`)
    }
  }

  const createFolder = async (dir = '') => {
    const suggested = dir ? `${dir}/new-folder` : 'new-folder'
    const path = window.prompt('New folder path', suggested)?.trim()
    if (!path) return
    try {
      setFiles(await makeWorkspaceDir(path))
      setOffline(false)
      pushLog(`> Created folder ${path}`)
    } catch (err) {
      pushLog(`ERROR: could not create folder ${path} — ${describeError(err)}`)
    }
  }

  const deleteEntry = async (path: string) => {
    if (!window.confirm(`Delete ${baseName(path)}? This cannot be undone.`)) return
    try {
      setFiles(await removeWorkspacePath(path))
      setOffline(false)
      const remaining = tabs.filter((tab) => !isWithin(tab.path, path))
      setTabs(remaining)
      if (activeFile && isWithin(activeFile, path)) {
        setActiveFile(remaining.length ? remaining[remaining.length - 1].path : null)
      }
      pushLog(`> Deleted ${path}`)
    } catch (err) {
      pushLog(`ERROR: could not delete ${path} — ${describeError(err)}`)
    }
  }

  const saveFile = async (): Promise<boolean> => {
    const tab = tabs.find((item) => item.path === activeFile)
    if (!tab) return false
    if (tab.content === tab.saved) return true
    try {
      setFiles(await writeWorkspaceFile(tab.path, tab.content))
      setOffline(false)
      setTabs((prev) =>
        prev.map((item) => (item.path === tab.path ? { ...item, saved: item.content } : item)),
      )
      pushLog(`> Saved ${tab.path}`)
      return true
    } catch (err) {
      pushLog(`ERROR: could not save ${tab.path} — ${describeError(err)}`)
      return false
    }
  }

  const runFile = async (target: string | null = activeFile) => {
    if (!target) return
    setPanelOpen(true)
    setPanelTab('terminal')
    const tab = tabs.find((item) => item.path === target)
    if (tab && tab.content !== tab.saved) {
      const saved = await saveFile()
      if (!saved) return
    }
    pushLog(`$ leo run ${target}`)
    setRunningPath(target)
    try {
      const result = await runWorkspaceFile(target)
      setOffline(false)
      pushLog(result.output || '(no output)')
      pushLog(result.ok ? `> Finished ${target}` : `ERROR: ${target} exited with an error`)
    } catch (err) {
      pushLog(`ERROR: could not run ${target} — ${describeError(err)}`)
    } finally {
      setRunningPath(null)
    }
  }

  const renameEntry = async (path: string) => {
    const next = window.prompt('Rename or move to', path)?.trim()
    if (!next || next === path) return
    try {
      setFiles(await renameWorkspacePath(path, next))
      setOffline(false)
      setTabs((prev) => prev.map((tab) => ({ ...tab, path: movePath(tab.path, path, next) })))
      setActiveFile((prev) => (prev ? movePath(prev, path, next) : prev))
      pushLog(`> Renamed ${path} to ${next}`)
    } catch (err) {
      pushLog(`ERROR: could not rename ${path} — ${describeError(err)}`)
    }
  }

  const updateContent = (code: string) => {
    if (!activeFile) return
    setTabs((prev) =>
      prev.map((tab) => (tab.path === activeFile ? { ...tab, content: code } : tab)),
    )
  }

  const closeTab = (path: string) => {
    const tab = tabs.find((item) => item.path === path)
    if (tab && tab.content !== tab.saved && !window.confirm(`Close ${baseName(path)} and discard changes?`)) {
      return
    }
    const remaining = tabs.filter((item) => item.path !== path)
    setTabs(remaining)
    if (activeFile === path) {
      setActiveFile(remaining.length ? remaining[remaining.length - 1].path : null)
    }
  }

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 's') {
        e.preventDefault()
        void saveFile()
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        void runFile()
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
  }, [activeFile, tabs, panelOpen, paletteOpen])

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

  const fileCount = files.filter((entry) => entry.kind === 'file').length
  const dirCount = files.filter((entry) => entry.kind === 'dir').length
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
          {offline && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30" title="Backend unreachable — the explorer is read-only">
              offline
            </span>
          )}
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
          {user.email && (
            <span className="hidden lg:inline text-[11px] text-white/40 truncate max-w-40" title={user.email}>
              {user.email}
            </span>
          )}
          {user.email && (
            <button
              onClick={async () => {
                try {
                  await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' })
                } catch {
                  // The cookie may already be gone; leave the workspace anyway.
                }
                window.location.href = '/'
              }}
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
            dirtyPaths={dirtyPaths}
            view={activeView}
            loading={loadingTree}
            offline={offline}
            onOpenFile={(path) => void openFile(path)}
            onCreateFile={(dir) => void createFile(dir)}
            onCreateFolder={(dir) => void createFolder(dir)}
            onRename={(path) => void renameEntry(path)}
            onDelete={(path) => void deleteEntry(path)}
            onRefresh={() => void refreshTree()}
            onToggle={() => setSidebarOpen(false)}
            onSelectView={setActiveView}
          />
        )}

        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <EditorArea
            tabs={openTabs}
            activeTab={activeTab}
            content={activeContent}
            onContentChange={updateContent}
            onSave={() => void saveFile()}
            onRun={() => void runFile()}
            onTabClick={(path) => void openFile(path)}
            onTabClose={closeTab}
            onCursorChange={(line, col) => setCursor({ line, col })}
            running={runningPath === activeFile}
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
        lineCol={`Ln ${cursor.line}, Col ${cursor.col} · ${languageLabel(activeFile)}`}
        recording={recording}
        onVoiceToggle={toggleRecording}
      />

      {showSuggestion && <ContextAwarePrompting onClose={() => setShowSuggestion(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={[
          {
            key: 'new-file',
            label: 'New File',
            description: 'Create a file in your workspace',
            run: () => void createFile(''),
          },
          {
            key: 'new-folder',
            label: 'New Folder',
            description: 'Create a folder in your workspace',
            run: () => void createFolder(''),
          },
          {
            key: 'save',
            label: 'Save File',
            description: 'Save the active file (Ctrl+S)',
            run: () => void saveFile(),
          },
          {
            key: 'run',
            label: 'Run File',
            description: 'Run the active file in the sandbox (Ctrl+Enter)',
            run: () => void runFile(),
          },
          {
            key: 'refresh',
            label: 'Refresh Explorer',
            description: 'Reload the file tree from the server',
            run: () => void refreshTree(),
          },
          {
            key: 'toggle-panel',
            label: 'Toggle Panel',
            description: 'Show or hide the terminal panel (Ctrl+J)',
            run: () => setPanelOpen((open) => !open),
          },
          {
            key: 'toggle-sidebar',
            label: 'Toggle Sidebar',
            description: 'Show or hide the explorer',
            run: () => setSidebarOpen((open) => !open),
          },
          {
            key: 'terminal',
            label: 'Show Terminal',
            description: 'Open the sandbox terminal output',
            run: () => {
              setPanelOpen(true)
              setPanelTab('terminal')
            },
          },
        ]}
      />
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

type PaletteCommand = {
  key: string
  label: string
  description: string
  run: () => void
}

function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
}) {
  const [q, setQ] = useState('')

  if (!open) return null
  const matches = commands.filter((command) =>
    command.label.toLowerCase().includes(q.trim().toLowerCase()),
  )

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur z-50 flex items-center justify-center">
      <div className="relative bg-[#1e1e1e] rounded-2xl p-8 w-80 max-w-full animate-pop border border-white/10">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded bg-white/10 text-white/50 flex items-center justify-center hover:bg-white/20 hover:text-white transition-colors"
          aria-label="Close command palette"
        >
          ×
        </button>
        <h3 className="text-lg mb-6 text-center text-white">Command Palette</h3>
        <input
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          value={q}
          className="w-full bg-[#252526] border border-white/10 rounded p-2 pl-3 focus:bg-[#3c3c3c] focus:border-[#635bff] focus:text-white placeholder-white/30 transition-colors"
          placeholder="Type a command..."
        />
        <div className="mt-4 space-y-1 max-h-80 overflow-y-auto">
          {matches.map((command) => (
            <button
              key={command.key}
              onClick={() => {
                onClose()
                command.run()
              }}
              className="w-full flex items-center gap-3 p-3 rounded text-left hover:bg-white/5 transition-colors"
            >
              <span className="w-1.5 h-1.5 bg-[#635bff] rounded-full shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium text-white text-sm">{command.label}</span>
                <span className="block text-xs text-white/40">{command.description}</span>
              </span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="p-3 text-xs text-white/30">No matching command.</p>
          )}
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
