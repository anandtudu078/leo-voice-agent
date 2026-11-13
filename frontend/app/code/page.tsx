'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

import { ActivityBar } from './ActivityBar'
import { SideBar } from './SideBar'
import { EditorArea } from './EditorArea'
import { EditReview, type EditProposal } from './EditReview'
import { Panel } from './Panel'
import { StatusBar } from './StatusBar'
import { VoiceStatus } from './VoiceStatus'
import { languageLabel } from '@/lib/highlight'
import { WavRecorder } from '@/lib/audio'
import {
  baseName,
  checkBackendHealth,
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

type ExplanationStep = {
  startLine: number
  endLine: number
  title: string
  what: string
  why: string
  syntax?: string[]
  code?: string
}

type PendingExplanation = {
  path: string
  code: string
  language: string
  goal: string
}

type ExplanationState = {
  path: string
  language: string
  goal: string
  steps: ExplanationStep[]
  index: number
  loading: boolean
  error: string | null
}

function classifyExplanationResponse(
  text: string,
): 'agree' | 'decline' | 'other' {
  const t = text.trim().toLowerCase()
  if (!t) return 'other'
  const agree =
    /\b(yes|yeah|yep|sure|ok|okay|explain|teach|walk\s*me|go\s*ahead|please\s+explain|show\s+me)\b/
  const decline =
    /\b(no|nope|nah|skip|not\s+now|continue|later|don'?t|do\s+not)\b/
  const hasAgree = agree.test(t)
  const hasDecline = decline.test(t)
  // "no, run it" / "continue and run" => treat as other command (continue based on voice command)
  const commandy =
    /\b(run|create|write|edit|open|delete|rename|save|build|fix|change|add|make|show|list)\b/
  if (hasDecline && commandy.test(t)) return 'other'
  if (hasAgree && !hasDecline) return 'agree'
  if (hasDecline && !hasAgree) return 'decline'
  if (hasAgree && hasDecline) return commandy.test(t) ? 'other' : 'decline'
  return 'other'
}

async function fetchExplanation(payload: {
  path: string
  code: string
  language: string
  goal: string
}): Promise<ExplanationStep[]> {
  const res = await fetch('/api/explain-code', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      (data as { detail?: string }).detail ||
      `Explanation failed (HTTP ${res.status})`
    throw new Error(detail)
  }
  const steps = (data as { steps?: ExplanationStep[] }).steps
  return Array.isArray(steps) ? steps : []
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Keep reviewable-edit commands out of the legacy autonomous write path.
// The voice socket turns these into diff proposals instead.
function looksLikeEditTranscript(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (
    /\b(explain|teach|describe|what|why|how|create|new|folder|directory|run|execute|start|open|show|read|view|list|undo|revert)\b/i.test(
      t,
    )
  )
    return false
  if (
    /\b(?:add|make|write|create|need)\s+(?:a\s+|the\s+)?(?:new\s+)?file\b/i.test(
      t,
    )
  )
    return false
  return /\b(change|update|modify|edit|fix|refactor|rename|improve|optimize|adjust|replace|rewrite|add|remove|insert|append|simplify|clean|make|write)\b/i.test(
    t,
  )
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
  const [voiceStatus, setVoiceStatus] = useState<
    'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'
  >('idle')

  // Pipeline stage states
  const [sttStatus, setSttStatus] = useState<'idle' | 'listening' | 'error'>(
    'idle',
  )
  const [agentStatus, setAgentStatus] = useState<
    'idle' | 'processing' | 'done' | 'error'
  >('idle')
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'speaking' | 'error'>(
    'idle',
  )

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
  setVoiceStatus: (
    status: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready',
  ) => void
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
  const [activeLog, setActiveLog] = useState(0)
  const [loading, setLoading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [loadingTree, setLoadingTree] = useState(true)
  const [offline, setOffline] = useState(false)
  const [recentImports, setRecentImports] = useState<
    { name: string; importedAt: number; fileCount: number }[]
  >([])
  const [runningPath, setRunningPath] = useState<string | null>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeView, setActiveView] = useState('explorer')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showSuggestion, setShowSuggestion] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<
    'terminal' | 'output' | 'problems' | 'voice'
  >('output')
  const [messages, setMessages] = useState<
    { id: number; role: 'user' | 'leo'; text: string }[]
  >([])
  const [creationMode, setCreationMode] = useState<'none' | 'ask' | 'path'>(
    'none',
  )
  const [autoCommand, setAutoCommand] = useState<
    'createFile' | 'writeFile' | 'createFolder' | 'editFile' | 'runFile' | null
  >(null)
  const [autoCommandPayload, setAutoCommandPayload] = useState<{
    path?: string
    code?: string
  } | null>(null)
  const [folderSelectMode, setFolderSelectMode] = useState<
    'none' | 'ask' | 'chosen'
  >('none')
  const [commandInput, setCommandInput] = useState('')
  const [pendingExplanation, setPendingExplanation] =
    useState<PendingExplanation | null>(null)
  const [explanation, setExplanation] = useState<ExplanationState | null>(null)
  const [pendingEdit, setPendingEdit] = useState<EditProposal | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [lastUserGoal, setLastUserGoal] = useState('')

  const pendingExplanationRef = useRef<PendingExplanation | null>(null)
  const lastUserGoalRef = useRef('')
  const skipNextAutoParseRef = useRef<string | null>(null)
  const explainedPathsRef = useRef<Set<string>>(new Set())
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    pendingExplanationRef.current = pendingExplanation
  }, [pendingExplanation])
  useEffect(() => {
    filesRef.current = files
  }, [files])
  useEffect(() => {
    lastUserGoalRef.current = lastUserGoal
  }, [lastUserGoal])

  const messageIdRef = useRef(0)
  const streamingLeoIdRef = useRef<number | null>(null)
  const offlineRef = useRef(false)
  const filesRef = useRef<WorkspaceEntry[]>([])
  const unmountingRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>(() => {})
  const lastParsedTranscriptRef = useRef('')
  const wsFallbackIndexRef = useRef(0)
  const wsTriedFallbackRef = useRef(false)

  const pushMessage = useCallback((role: 'user' | 'leo', text: string) => {
    if (!text) return
    setMessages((prev) => [
      ...prev.slice(-59),
      { id: ++messageIdRef.current, role, text },
    ])
  }, [])

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () =>
        reject(reader.error ?? new Error('Could not read the recording'))
      reader.readAsDataURL(blob)
    })

  const activeTab = activeFile
  const activeContent =
    tabs.find((tab) => tab.path === activeFile)?.content ?? ''
  const activeExplainRange =
    explanation &&
    explanation.path === activeFile &&
    explanation.steps[explanation.index]
      ? {
          startLine: explanation.steps[explanation.index].startLine,
          endLine: explanation.steps[explanation.index].endLine,
        }
      : null
  const openTabs = tabs.map((tab) => ({
    path: tab.path,
    label: baseName(tab.path),
    dirty: tab.content !== tab.saved,
  }))
  const dirtyPaths = tabs
    .filter((tab) => tab.content !== tab.saved)
    .map((tab) => tab.path)
  const pendingEditTab = pendingEdit
    ? tabs.find((tab) => tab.path === pendingEdit.path)
    : null
  const pendingEditDirty =
    !!pendingEditTab && pendingEditTab.content !== pendingEditTab.saved

  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<WavRecorder | null>(null)

  // ---- Voice status badge config ----
  const statusBadge = useMemo(() => {
    const map: Record<string, { label: string; css: string }> = {
      idle: { label: 'Idle', css: 'bg-white/10 text-white/60 border-white/10' },
      listening: {
        label: 'Listening',
        css: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      },
      processing: {
        label: 'Processing',
        css: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      },
      disconnected: {
        label: 'Disconnected',
        css: 'bg-red-500/20 text-red-400 border-red-500/30',
      },
      ready: {
        label: 'Live',
        css: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      },
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
        ? prev.map((tab) =>
            tab.path === path ? { ...tab, content, saved: content } : tab,
          )
        : [...prev, { path, content, saved: content }],
    )
    setActiveFile(path)
    setCursor({ line: 1, col: 1 })
  }, [])

  const recordRecentImport = useCallback((name: string, fileCount: number) => {
    setRecentImports((prev) => {
      const next = [
        { name, importedAt: Date.now(), fileCount },
        ...prev.filter((r) => r.name !== name),
      ].slice(0, 8)
      try {
        window.localStorage.setItem('leo_recent_imports', JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const clearRecentImports = useCallback(() => {
    setRecentImports([])
    try {
      window.localStorage.removeItem('leo_recent_imports')
    } catch {
      // ignore
    }
  }, [])

  const dismissPendingExplanation = useCallback(() => {
    setPendingExplanation(null)
  }, [])

  const startExplanation = useCallback(
    async (pending?: PendingExplanation | null) => {
      const target = pending || pendingExplanationRef.current
      if (!target || !target.code.trim()) return
      const goal = target.goal || lastUserGoalRef.current || ''
      const path = target.path
      setPendingExplanation(null)
      setExplanation({
        path,
        language: target.language || 'code',
        goal,
        steps: [],
        index: 0,
        loading: true,
        error: null,
      })
      pushMessage('leo', `Explaining ${baseName(path)} line by line…`)
      setPanelOpen(true)
      setPanelTab('voice')
      try {
        const steps = await fetchExplanation({
          path,
          code: target.code,
          language: target.language,
          goal,
        })
        setExplanation((prev) =>
          prev && prev.path === path
            ? { ...prev, steps, index: 0, loading: false, error: null }
            : prev,
        )
        if (!steps.length) {
          setExplanation((prev) =>
            prev && prev.path === path
              ? {
                  ...prev,
                  loading: false,
                  error: 'No explanation steps were generated.',
                }
              : prev,
          )
        }
      } catch (err) {
        const message = describeError(err)
        setExplanation((prev) =>
          prev && prev.path === path
            ? { ...prev, loading: false, error: message }
            : prev,
        )
        pushLog(`ERROR: could not explain ${path} — ${message}`)
      }
    },
    [pushLog, pushMessage],
  )

  const respondToPendingExplanation = useCallback(
    (text: string): boolean => {
      const pending = pendingExplanationRef.current
      if (!pending) return false
      const kind = classifyExplanationResponse(text)
      if (kind === 'agree') {
        pushMessage(
          'leo',
          `Sure — I’ll explain ${baseName(pending.path)} and its syntax.`,
        )
        void startExplanation(pending)
        return true
      }
      if (kind === 'decline') {
        setPendingExplanation(null)
        pushMessage(
          'leo',
          'Okay, I’ll skip the explanation. Tell me what to do next.',
        )
        return true
      }
      // Other command: dismiss prompt and let normal command handling continue.
      setPendingExplanation(null)
      return false
    },
    [pushMessage, startExplanation],
  )

  const refreshTree = useCallback(async () => {
    try {
      setFiles(await listWorkspace())
      if (offlineRef.current)
        pushLog('> Backend reconnected — workspace reloaded')
      offlineRef.current = false
      setOffline(false)
    } catch (err) {
      if (!offlineRef.current) {
        pushLog(`ERROR: could not load the workspace — ${describeError(err)}`)
      }
      offlineRef.current = true
      setOffline(true)
    }
  }, [pushLog])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem('leo_recent_imports')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setRecentImports(
            parsed
              .filter(
                (x) =>
                  x &&
                  typeof x.name === 'string' &&
                  typeof x.fileCount === 'number',
              )
              .slice(0, 8),
          )
        }
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void listWorkspace()
      .then((entries) => {
        if (cancelled) return
        setFiles(entries)
        offlineRef.current = false
        setOffline(false)
      })
      .catch((err) => {
        if (cancelled) return
        offlineRef.current = true
        setOffline(true)
        pushLog(`ERROR: could not load the workspace — ${describeError(err)}`)
      })
      .finally(() => {
        if (!cancelled) setLoadingTree(false)
      })
    return () => {
      cancelled = true
    }
  }, [pushLog])

  // ---- WebSocket connection ----
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return
    const fallbackUrls = [
      'https://leo-voice-agent.onrender.com',
      'https://leo-voice-agent.onrender.com',
      'https://leo-voice-agent.onrender.com',
    ]
    const resolveBackendUrl = () => {
      const fromEnv = (process.env.NEXT_PUBLIC_BACKEND_URL || '').trim()
      if (fromEnv) {
        // If env contains spaces or multiple URLs, take the first valid http(s) URL
        const first = fromEnv.split(/\s+/)[0]
        return first.replace(/\/+$/, '').replace(/\/api\/?$/, '')
      }
      if (typeof window !== 'undefined') {
        const host = window.location.hostname
        if (host === 'localhost' || host === '127.0.0.1')
          return 'http://localhost:8000'
      }
      return fallbackUrls[wsFallbackIndexRef.current] || fallbackUrls[0]
    }
    let backendUrl = resolveBackendUrl()
    // Extra sanitization: if it contains spaces or is malformed, fall back
    if (backendUrl.includes(' ') || !/^https?:\/\//i.test(backendUrl)) {
      backendUrl = 'https://leo-voice-agent.onrender.com'
    }
    const wsUrl = `${backendUrl.replace(/^http/i, 'ws').replace(/\/+$/, '')}/ws/process-voice`
    try {
      console.log('[voice] connecting to', wsUrl)
    } catch {}
    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    ws.onopen = () => {
      try {
        console.log('[voice] connected')
      } catch {}
      wsFallbackIndexRef.current = 0
      wsTriedFallbackRef.current = false
      setVoiceStatus('ready')
    }
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
              if (msg.files.length > 0) {
                setFiles(msg.files)
              }
              // If backend returns empty files, keep existing files (don't wipe starter/local files)
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
            if (typeof msg.path === 'string' && msg.path) {
              const p = msg.path
              const content = typeof msg.content === 'string' ? msg.content : ''
              adoptFile(p, content)
              setFiles((prev) => {
                if (prev.some((f) => f.path === p)) return prev
                const name = p.split('/').pop() || p
                return [...prev, { path: p, name, kind: 'file' as const }].sort(
                  (a, b) => a.path.localeCompare(b.path),
                )
              })
              // v1: after the agent writes code, ask before explaining it.
              // Edits applied through review/undo are not new code, so skip.
              if (
                content.trim() &&
                msg.origin !== 'edit' &&
                !explainedPathsRef.current.has(p)
              ) {
                explainedPathsRef.current.add(p)
                const goal = lastUserGoalRef.current || transcript || ''
                const language = p.endsWith('.py')
                  ? 'python'
                  : p.endsWith('.ts') || p.endsWith('.tsx')
                    ? 'typescript'
                    : p.endsWith('.js') || p.endsWith('.jsx')
                      ? 'javascript'
                      : 'code'
                setPendingExplanation({
                  path: p,
                  code: content,
                  language,
                  goal,
                })
                pushMessage(
                  'leo',
                  `I’ve written ${baseName(p)}. Should I explain the code and syntax line by line?`,
                )
                setPanelOpen(true)
                setPanelTab('voice')
              }
            }
            break
          case 'edit-proposal': {
            const p = typeof msg.path === 'string' ? msg.path : ''
            if (!p) break
            const oldCode = typeof msg.old_code === 'string' ? msg.old_code : ''
            const newCode = typeof msg.new_code === 'string' ? msg.new_code : ''
            setPendingEdit({
              path: p,
              old_code: oldCode,
              new_code: newCode,
              diff: String(msg.diff || ''),
              summary: String(msg.summary || ''),
              added: Number(msg.added) || 0,
              removed: Number(msg.removed) || 0,
            })
            setEditBusy(false)
            setEditError(null)
            setPendingExplanation(null)
            setTabs((prev) =>
              prev.some((tab) => tab.path === p)
                ? prev
                : [...prev, { path: p, content: oldCode, saved: oldCode }],
            )
            setActiveFile(p)
            setPanelOpen(true)
            setLogs((prev) => [...prev, `> Review edit: ${p}`])
            break
          }
          case 'edit-result': {
            setEditBusy(false)
            if (msg.ok) {
              setPendingEdit(null)
              setEditError(null)
              if (msg.action) {
                setLogs((prev) => [
                  ...prev,
                  `> Edit ${String(msg.action)}: ${String(msg.path || '')}`,
                ])
              }
            } else {
              const error = String(
                msg.error || 'The edit could not be applied.',
              )
              setEditError(error)
              setLogs((prev) => [...prev, `ERROR: ${error}`])
              // Drop proposals the server no longer has (stale base, reconnect,
              // or a different pending file).
              if (
                /changed after|no pending edit|pending edit is for/i.test(error)
              )
                setPendingEdit(null)
            }
            break
          }
          case 'transcript': {
            const t = msg.transcript || ''
            setTranscript(t)
            pushMessage('user', t)
            setLastUserGoal(t)
            lastUserGoalRef.current = t
            setVoiceStatus('ready')
            setSttStatus('idle')
            // v1: if Leo asked to explain code, handle yes/no here; other commands continue.
            if (pendingExplanationRef.current && t.trim()) {
              const kind = classifyExplanationResponse(t)
              if (kind === 'agree') {
                skipNextAutoParseRef.current = t
                pushMessage(
                  'leo',
                  `Sure — I’ll explain ${baseName(pendingExplanationRef.current.path)} and its syntax.`,
                )
                void startExplanation(pendingExplanationRef.current)
                break
              }
              if (kind === 'decline') {
                skipNextAutoParseRef.current = t
                setPendingExplanation(null)
                pushMessage(
                  'leo',
                  'Okay, I’ll skip the explanation. Tell me what to do next.',
                )
                break
              }
              // "other" => clear prompt and let autonomous command parsing proceed.
              setPendingExplanation(null)
            }
            // Autonomous command processing is handled by a useEffect below
            break
          }
          case 'code':
            setLogs((prev) => [...prev, `{ Agent: ${msg.code || ''} }`])
            if (msg.code && msg.code.includes('FileContent')) {
              setLogs((prev) => [...prev, `{ Agent read: ${msg.code} }`])
            }
            setVoiceStatus('ready')
            setAgentStatus('done')
            break
          case 'logs': {
            const lines: string[] = Array.isArray(msg.logs) ? msg.logs : []
            setLogs((prev) => [...prev, ...lines])
            if (Array.isArray(msg.files) && msg.files.length > 0)
              setFiles(msg.files)
            // Safety net: when the backend saves a file (including from agent/tool flows),
            // re-read it so the editor/codespace stays in sync with disk.
            try {
              const wsOpen = ws?.readyState === WebSocket.OPEN
              if (wsOpen) {
                for (const line of lines) {
                  const m =
                    typeof line === 'string'
                      ? line.match(/^>\s*Saved\s+(.+?)\s+\(/)
                      : null
                  if (m?.[1]) {
                    ws.send(
                      JSON.stringify({ type: 'read_file', path: m[1].trim() }),
                    )
                  }
                }
              }
            } catch {
              // non-fatal sync hint
            }
            setVoiceStatus('ready')
            break
          }
          case 'reply_delta': {
            const delta = String(msg.delta || '')
            if (!delta) break
            setVoiceStatus('ready')
            setAgentStatus('processing')
            setMessages((prev) => {
              const sid = streamingLeoIdRef.current
              if (sid != null) {
                return prev.map((m) =>
                  m.id === sid ? { ...m, text: m.text + delta } : m,
                )
              }
              const id = ++messageIdRef.current
              streamingLeoIdRef.current = id
              return [
                ...prev.slice(-59),
                { id, role: 'leo' as const, text: delta },
              ]
            })
            break
          }
          case 'reply': {
            // Finalize: if streamed, update the in-progress message; otherwise show immediately.
            const text = String(msg.text || '')
            const streamed =
              Boolean(msg.streamed) && streamingLeoIdRef.current != null
            if (streamed) {
              const sid = streamingLeoIdRef.current
              streamingLeoIdRef.current = null
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === sid ? { ...m, text: text || m.text } : m,
                ),
              )
              if (text) setLogs((prev) => [...prev, `{ Agent says: ${text} }`])
            } else if (text) {
              streamingLeoIdRef.current = null
              setLogs((prev) => [...prev, `{ Agent says: ${text} }`])
              pushMessage('leo', text)
            }
            setVoiceStatus('ready')
            setAgentStatus('done')
            if (msg.tts === 'pending') setTtsStatus('idle')
            break
          }
          case 'speech': {
            const text = String(msg.text || '')
            const audioOnly = Boolean(msg.audio_only)
            if (!audioOnly && text) {
              setLogs((prev) => [...prev, `{ Agent says: ${text} }`])
              pushMessage('leo', text)
            }
            setVoiceStatus('ready')
            setAgentStatus('done')
            try {
              const base64 = String(msg.speech || msg.audio || '')
              if (base64) {
                const binary = atob(base64)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++)
                  bytes[i] = binary.charCodeAt(i)
                // Gnani returns WAV; keep the blob URL alive until playback ends.
                const blob = new Blob([bytes], { type: 'audio/wav' })
                const url = URL.createObjectURL(blob)
                const audio = new Audio(url)
                setTtsStatus('speaking')
                audio.onended = () => {
                  URL.revokeObjectURL(url)
                  setTtsStatus('idle')
                }
                audio.onerror = () => {
                  URL.revokeObjectURL(url)
                  setTtsStatus('error')
                }
                audio.play().catch(() => {
                  URL.revokeObjectURL(url)
                  setTtsStatus('error')
                })
              } else {
                setTtsStatus('idle')
              }
            } catch {
              setTtsStatus('error')
            }
            break
          }
          case 'error': {
            const message = String(msg.error || '')
            setLogs((prev) => [...prev, `ERROR: ${message}`])
            // A failed turn does not close the socket, so only report a
            // disconnection when the connection is actually gone.
            const connected = ws.readyState === WebSocket.OPEN
            setVoiceStatus(connected ? 'ready' : 'disconnected')
            if (/transcri|\bstt\b|no speech|audio format/i.test(message)) {
              setSttStatus('error')
            } else if (/\btts\b|synth|voice/i.test(message)) {
              setTtsStatus('error')
            } else if (connected) {
              setAgentStatus('error')
            }
            break
          }
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = (ev) => {
      try {
        console.log('[voice] closed', ev?.code, ev?.reason)
      } catch {}
      // Try a fallback backend once if the primary failed to connect.
      if (!wsTriedFallbackRef.current && wsFallbackIndexRef.current === 0) {
        wsTriedFallbackRef.current = true
        wsFallbackIndexRef.current = 1
        try {
          socketRef.current = null
        } catch {}
        if (!unmountingRef.current) {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
          reconnectTimerRef.current = setTimeout(
            () => connectRef.current(),
            500,
          )
          return
        }
      }
      setVoiceStatus('idle')
      // Reconnect on our own so a backend restart does not end the session.
      if (!unmountingRef.current) {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = setTimeout(() => connectRef.current(), 3000)
      }
    }

    ws.onerror = (ev) => {
      try {
        console.log('[voice] error')
      } catch {}
      if (!wsTriedFallbackRef.current && wsFallbackIndexRef.current === 0) {
        wsTriedFallbackRef.current = true
        wsFallbackIndexRef.current = 1
        try {
          socketRef.current = null
        } catch {}
        if (!unmountingRef.current) {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
          reconnectTimerRef.current = setTimeout(
            () => connectRef.current(),
            500,
          )
          return
        }
      }
      setVoiceStatus('disconnected')
    }
    // State setters are stable, so this effect connects once instead of
    // reconnecting every time the voice status or transcript changes.
  }, [pushMessage, setVoiceStatus, setSttStatus, setAgentStatus, setTtsStatus])

  connectRef.current = connect

  useEffect(() => {
    connect()
    return () => {
      unmountingRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      socketRef.current?.close()
      void recorderRef.current?.stop()
      recorderRef.current = null
    }
  }, [connect])

  // Keep the backend warm and recover automatically after a restart: when the
  // health probe answers, refresh the tree and reopen the voice socket.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (!(await checkBackendHealth())) return
      void refreshTree()
      if (!socketRef.current || socketRef.current.readyState > WebSocket.OPEN) {
        connectRef.current()
      }
    }, 10000)
    return () => clearInterval(timer)
  }, [refreshTree])

  // Process autonomous voice commands:
  useEffect(() => {
    // Listen for transcript from WebSocket and auto-detect commands
    const trimmed = transcript.trim()
    if (trimmed && trimmed !== lastParsedTranscriptRef.current) {
      if (
        skipNextAutoParseRef.current &&
        skipNextAutoParseRef.current === trimmed
      ) {
        lastParsedTranscriptRef.current = trimmed
        skipNextAutoParseRef.current = null
        // handled (explain yes/no)
      } else {
        lastParsedTranscriptRef.current = trimmed
        // Existing-file edits are proposed as diffs by the voice socket.
        // Running the legacy parser too would generate a second copy and
        // auto-write it, bypassing review. With no target file, let the
        // legacy create-file path handle requests like "write a script".
        const namesAnOpenOrKnownFile = filesRef.current.some(
          (entry) =>
            entry.kind === 'file' &&
            trimmed.toLowerCase().includes(entry.name.toLowerCase()),
        )
        if (
          (activeFile || namesAnOpenOrKnownFile) &&
          looksLikeEditTranscript(trimmed)
        ) {
          return
        }
        // Parse the transcript using the backend /api/parse-voice-command
        fetch('/api/parse-voice-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: trimmed }),
        })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}))
            if (data.action && data.action !== 'none') {
              // Store the action and payload for autonomous dispatch when socket is ready
              setAutoCommand(data.action)
              setAutoCommandPayload(data.payload || null)
            }
          })
          .catch((err) => {
            console.error('Failed to parse voice command:', err)
          })
      }
    }
    // Handle autonomous command dispatch - do not check socket readiness here,
    // the dispatch happens when the effect re-runs after socket connects
    if (autoCommand === 'createFile' || autoCommand === 'writeFile') {
      const path = autoCommandPayload?.path || 'untitled.py'
      const code = autoCommandPayload?.code || ''
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        // Never blind-write over an existing file: the socket has either
        // already sent an edit proposal or will do so for this request.
        if (
          filesRef.current.some(
            (entry) => entry.path === path && entry.kind === 'file',
          )
        ) {
          pushLog(`> Preparing a reviewable edit to ${path}`)
          setAutoCommand(null)
          setAutoCommandPayload(null)
          return
        }
        socketRef.current.send(
          JSON.stringify({ type: 'write_file', path, code }),
        )
        pushMessage(
          'leo',
          autoCommand === 'writeFile'
            ? '> Updating ' + path
            : '> Created ' + path,
        )
        pushLog(
          autoCommand === 'writeFile'
            ? '> Updating ' + path
            : '> Created ' + path,
        )
        setAutoCommand(null)
        setAutoCommandPayload(null)
      }
      return
    }
    if (autoCommand === 'createFolder') {
      const path = autoCommandPayload?.path || ''
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'mkdir', path }))
        pushMessage('leo', '> Created folder ' + path)
        pushLog('> Created folder ' + path)
        setAutoCommand(null)
        setAutoCommandPayload(null)
      }
      return
    }
    if (autoCommand === 'editFile') {
      const path = autoCommandPayload?.path || ''
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'editFile', path }))
        pushMessage('leo', '> Opening ' + path)
        pushLog('> Opening ' + path)
        setAutoCommand(null)
        setAutoCommandPayload(null)
      }
      return
    }
    if (autoCommand === 'runFile') {
      const path = autoCommandPayload?.path || ''
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'run_script', path }))
        setAutoCommand(null)
        setAutoCommandPayload(null)
      }
      return
    }
  }, [
    transcript,
    autoCommand,
    autoCommandPayload,
    activeFile,
    pushLog,
    socketRef,
  ])
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

  const shouldSkipImportPath = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    const skip = new Set([
      '.git',
      'node_modules',
      '__pycache__',
      '.venv',
      'venv',
      '.next',
      '.idea',
      '.vscode',
      'dist',
      'build',
    ])
    return parts.some((p) => skip.has(p))
  }

  const isLikelyBinary = (bytes: Uint8Array) => {
    const sample = bytes.subarray(0, Math.min(bytes.length, 512))
    let suspicious = 0
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i]
      if (b === 0) return true
      if (b < 7 || (b > 13 && b < 32) || b === 127) suspicious++
    }
    return sample.length > 0 && suspicious / sample.length > 0.3
  }

  const uploadLocalFiles = async (
    entries: Array<{ path: string; file: File }>,
    folderName?: string,
  ) => {
    const filtered = entries.filter(
      (e) => e.path && !shouldSkipImportPath(e.path),
    )
    if (!filtered.length) {
      pushMessage('leo', 'No files to import from the selected folder.')
      return
    }
    setLoading(true)
    pushLog(`> Importing ${filtered.length} file(s) from system folder…`)
    let imported = 0
    let skipped = 0
    let lastFiles: WorkspaceEntry[] | null = null
    try {
      for (const entry of filtered) {
        try {
          const buf = new Uint8Array(await entry.file.arrayBuffer())
          if (isLikelyBinary(buf)) {
            skipped++
            continue
          }
          const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
          lastFiles = await writeWorkspaceFile(entry.path, text)
          imported++
        } catch {
          skipped++
        }
      }
      if (lastFiles) setFiles(lastFiles)
      else setFiles(await listWorkspace())
      pushLog(
        `> Imported ${imported} file(s)${skipped ? `, skipped ${skipped}` : ''}.`,
      )
      pushMessage(
        'leo',
        `Imported ${imported} file(s) from the selected folder${skipped ? ` (skipped ${skipped} binary/unreadable)` : ''}.`,
      )
      if (imported > 0) {
        setSidebarOpen(true)
        recordRecentImport(folderName || 'Imported folder', imported)
      }
    } catch (err) {
      pushLog(`ERROR: could not import folder — ${describeError(err)}`)
      pushMessage('leo', `Could not import folder: ${describeError(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const openSystemFolder = async () => {
    const picker = (window as any).showDirectoryPicker as
      undefined | (() => Promise<any>)
    if (picker) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({
          mode: 'read',
        })
        const collected: Array<{ path: string; file: File }> = []
        const walk = async (handle: any, prefix: string) => {
          for await (const [name, child] of handle.entries()) {
            const rel = prefix ? `${prefix}/${name}` : name
            if (shouldSkipImportPath(rel)) continue
            if (child.kind === 'file') {
              try {
                const file = await child.getFile()
                collected.push({ path: rel, file })
              } catch {
                // ignore unreadable
              }
            } else if (child.kind === 'directory') {
              await walk(child, rel)
            }
            if (collected.length >= 500) break
          }
        }
        await walk(dirHandle, '')
        await uploadLocalFiles(collected, dirHandle?.name || 'Imported folder')
        return
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        pushLog(
          `> Folder picker API unavailable/failed, using fallback: ${describeError(err)}`,
        )
      }
    }
    folderInputRef.current?.click()
  }

  const onFolderInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return
    const filesArr = Array.from(fileList)
    const collected = filesArr.map((f) => {
      const rel =
        (f as any).webkitRelativePath && String((f as any).webkitRelativePath)
          ? String((f as any).webkitRelativePath)
          : f.name
      const parts = rel.split('/').filter(Boolean)
      const path = parts.length > 1 ? parts.slice(1).join('/') : rel
      return { path, file: f }
    })
    const folderName =
      filesArr[0] &&
      (filesArr[0] as any).webkitRelativePath &&
      String((filesArr[0] as any).webkitRelativePath)
        .split('/')
        .filter(Boolean)[0]
        ? String((filesArr[0] as any).webkitRelativePath)
            .split('/')
            .filter(Boolean)[0]
        : 'Imported folder'
    e.target.value = ''
    await uploadLocalFiles(collected, folderName)
  }

  const deleteEntry = async (path: string) => {
    if (!window.confirm(`Delete ${baseName(path)}? This cannot be undone.`))
      return
    try {
      setFiles(await removeWorkspacePath(path))
      setOffline(false)
      const remaining = tabs.filter((tab) => !isWithin(tab.path, path))
      setTabs(remaining)
      if (activeFile && isWithin(activeFile, path)) {
        setActiveFile(
          remaining.length ? remaining[remaining.length - 1].path : null,
        )
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
        prev.map((item) =>
          item.path === tab.path ? { ...item, saved: item.content } : item,
        ),
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
      pushLog(
        result.ok
          ? `> Finished ${target}`
          : `ERROR: ${target} exited with an error`,
      )
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
      setTabs((prev) =>
        prev.map((tab) => ({ ...tab, path: movePath(tab.path, path, next) })),
      )
      setActiveFile((prev) => (prev ? movePath(prev, path, next) : prev))
      pushLog(`> Renamed ${path} to ${next}`)
    } catch (err) {
      pushLog(`ERROR: could not rename ${path} — ${describeError(err)}`)
    }
  }

  const updateContent = (code: string) => {
    if (!activeFile) return
    setTabs((prev) =>
      prev.map((tab) =>
        tab.path === activeFile ? { ...tab, content: code } : tab,
      ),
    )
  }

  const closeTab = (path: string) => {
    const tab = tabs.find((item) => item.path === path)
    if (
      tab &&
      tab.content !== tab.saved &&
      !window.confirm(`Close ${baseName(path)} and discard changes?`)
    ) {
      return
    }
    const remaining = tabs.filter((item) => item.path !== path)
    setTabs(remaining)
    if (activeFile === path) {
      setActiveFile(
        remaining.length ? remaining[remaining.length - 1].path : null,
      )
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
  // The STT API accepts wav/ogg/mp3/m4a/flac/aac but not the WebM/Opus that
  // MediaRecorder produces in Chrome, so capture PCM and send a WAV blob.
  const startRecording = async () => {
    if (recording || !navigator.mediaDevices?.getUserMedia) return
    setLoading(true)
    setLogs((prev) => [...prev, '> Listening… speak, then press Stop'])
    setVoiceStatus('listening')
    setSttStatus('listening')
    try {
      recorderRef.current = await WavRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error('Microphone unavailable:', err)
      setLogs((prev) => [...prev, `ERROR: ${describeError(err)}`])
      setVoiceStatus(
        socketRef.current?.readyState === WebSocket.OPEN
          ? 'ready'
          : 'disconnected',
      )
      setSttStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const stopRecording = async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    if (!recorder) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const blob = await recorder.stop()
      if (blob.size === 0) {
        setLogs((prev) => [
          ...prev,
          'ERROR: no audio captured — try speaking again',
        ])
        setVoiceStatus('ready')
        setSttStatus('error')
        return
      }
      const base64 = await blobToDataUrl(blob)
      if (base64 && socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'audio',
            data: base64,
            path: activeFile || '',
          }),
        )
        setVoiceStatus('processing')
        setSttStatus('listening')
      } else {
        setLogs((prev) => [...prev, 'ERROR: voice socket is not connected'])
        setVoiceStatus('disconnected')
      }
    } catch (err) {
      setLogs((prev) => [...prev, `ERROR: ${describeError(err)}`])
      setVoiceStatus('disconnected')
      setSttStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const toggleRecording = () => {
    if (recording) void stopRecording()
    else void startRecording()
  }

  const sendTextCommand = async () => {
    const text = commandInput.trim()
    if (!text) return
    setLastUserGoal(text)
    lastUserGoalRef.current = text

    // v1: handle permission to explain code/syntax after Leo writes code.
    if (pendingExplanationRef.current) {
      const kind = classifyExplanationResponse(text)
      if (kind === 'agree') {
        pushMessage('user', text)
        pushMessage(
          'leo',
          `Sure — I’ll explain ${baseName(pendingExplanationRef.current.path)} and its syntax.`,
        )
        void startExplanation(pendingExplanationRef.current)
        setCommandInput('')
        setPanelTab('voice')
        return
      }
      if (kind === 'decline') {
        pushMessage('user', text)
        setPendingExplanation(null)
        pushMessage(
          'leo',
          'Okay, I’ll skip the explanation. Tell me what to do next.',
        )
        setCommandInput('')
        setPanelTab('voice')
        return
      }
      // Other command/text: dismiss the prompt and continue with normal handling.
      setPendingExplanation(null)
    }

    // Conversational file creation assistant
    const createFileRegex = /(create|new)\s+a?\s+file/i
    if (createFileRegex.test(text) && creationMode === 'none') {
      setCreationMode('ask')
      pushMessage(
        'leo',
        "I'd be happy to help you create a new file! What's the file path (e.g., `components/Leo.tsx`)? You can also say 'open folder' or 'clone a repo'.",
      )
      setCommandInput('')
      return
    }

    // Conversational folder selection assistant
    if (folderSelectMode === 'none') {
      const selectFolderRegex = /(select|choose)\s+a?\s+folder/i
      if (selectFolderRegex.test(text)) {
        setFolderSelectMode('ask')
        pushMessage(
          'leo',
          'I can list your folders. Please type the path of the folder you want (e.g., `components`).',
        )
        setCommandInput('')
        return
      }
    }

    if (folderSelectMode === 'ask') {
      const path = text.trim()
      if (path) {
        try {
          const entries = await listWorkspace()
          const folder = entries.find(
            (e) => e.kind === 'dir' && e.path === path,
          )
          if (folder) {
            setActiveFile(path)
            setFolderSelectMode('chosen')
            pushMessage('leo', `> Selected folder ${path}`)
            pushLog(`> Selected folder ${path}`)
          } else {
            const match = entries.find(
              (e) =>
                e.kind === 'dir' &&
                (e.path === path || e.path.startsWith(path + '/')),
            )
            if (match) {
              setActiveFile(match.path)
              setFolderSelectMode('chosen')
              pushMessage('leo', `> Selected folder ${match.path}`)
              pushLog(`> Selected folder ${match.path}`)
            } else {
              pushMessage(
                'leo',
                `I couldn't find a folder at "${path}". Type the full path or try a different name.`,
              )
            }
          }
        } catch (err) {
          pushMessage(
            'leo',
            `ERROR: could not list folders — ${describeError(err)}`,
          )
          pushLog(`ERROR: could not list folders — ${describeError(err)}`)
        }
        setFolderSelectMode('none')
      } else {
        pushMessage(
          'leo',
          "I didn't catch the folder path. Please type the path (e.g., `components`).",
        )
      }
      setCommandInput('')
      return
    }

    if (creationMode === 'ask') {
      const path = text.trim()
      if (path) {
        try {
          setFiles(await writeWorkspaceFile(path, ''))
          setOffline(false)
          pushMessage('leo', `> Created ${path}`)
          pushLog(`> Created ${path}`)
        } catch (err) {
          pushMessage(
            'leo',
            `ERROR: could not create ${path} — ${describeError(err)}`,
          )
          pushLog(`ERROR: could not create ${path} — ${describeError(err)}`)
        }
        setCreationMode('none')
      } else {
        pushMessage(
          'leo',
          "I didn't catch the path. Please tell me the file path (e.g., `components/Leo.tsx`).",
        )
      }
      setCommandInput('')
      return
    }

    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      pushLog('ERROR: voice socket is not connected — retrying in a moment')
      connectRef.current()
      return
    }
    socketRef.current.send(
      JSON.stringify({ type: 'text', text, path: activeFile || '' }),
    )
    setCommandInput('')
    setPanelTab('voice')
  }

  const acceptPendingEdit = () => {
    if (!pendingEdit) return
    setPendingExplanation(null)
    if (pendingEditDirty) {
      setEditError(
        'Save or discard your unsaved editor changes before applying this edit.',
      )
      return
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setEditError('The voice socket is not connected. Reconnecting…')
      connectRef.current()
      return
    }
    setEditBusy(true)
    setEditError(null)
    socketRef.current.send(
      JSON.stringify({ type: 'accept_edit', path: pendingEdit.path }),
    )
  }

  const rejectPendingEdit = () => {
    if (!pendingEdit) return
    const path = pendingEdit.path
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'reject_edit', path }))
    }
    setPendingEdit(null)
    setEditBusy(false)
    setEditError(null)
    pushLog(`> Rejected the proposed edit to ${path}`)
  }

  const undoLastEdit = () => {
    if (!activeFile) return
    setPendingExplanation(null)
    const tab = tabs.find((item) => item.path === activeFile)
    if (tab && tab.content !== tab.saved) {
      pushLog(
        'ERROR: save or discard your unsaved changes before undoing an edit',
      )
      return
    }
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      pushLog('ERROR: voice socket is not connected — cannot undo right now')
      return
    }
    socketRef.current.send(
      JSON.stringify({ type: 'undo_edit', path: activeFile }),
    )
    pushLog(`> Undoing the last agent edit to ${activeFile}…`)
  }

  const fileCount = files.filter((entry) => entry.kind === 'file').length
  const dirCount = files.filter((entry) => entry.kind === 'dir').length
  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--ide-bg)] text-white">
      {/* ===== Title bar ===== */}
      <header className="ide-titlebar flex items-center justify-between gap-3 px-3 h-11 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#635bff] to-[#8b83ff] flex items-center justify-center shrink-0 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19v3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <rect x="9" y="2" width="6" height="13" rx="3" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-tight truncate text-white/95">
              Leo Voice Workspace
            </div>
            <div className="hidden md:block text-[10px] text-white/40 truncate max-w-64">
              {activeFile || 'No file open'} · {fileCount} files
              {dirCount ? `, ${dirCount} folders` : ''} · Voice-first coding
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {offline && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30"
              title="Backend unreachable — the explorer is read-only"
            >
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
            onClick={undoLastEdit}
            disabled={!activeFile}
            className="text-xs px-2.5 py-1.5 rounded-md border border-white/10 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            title="Undo the last agent edit to this file (or say “undo that”)"
          >
            Undo
          </button>
          <button
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-all ${
              recording
                ? 'bg-red-500/20 text-red-200 border-red-500/40 hover:bg-red-500/30 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]'
                : 'bg-[#635bff]/20 text-[#e9e7ff] border-[#635bff]/35 hover:bg-[#635bff]/30 hover:border-[#635bff]/50'
            }`}
            title={
              recording ? 'Stop and send the command' : 'Record a voice command'
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
            {recording ? 'Stop & send' : 'Speak'}
          </button>
          {user.email && (
            <span
              className="hidden lg:inline text-[11px] text-white/40 truncate max-w-40"
              title={user.email}
            >
              {user.email}
            </span>
          )}
          {user.email && (
            <button
              onClick={async () => {
                try {
                  await fetch('/api/auth/signout', {
                    method: 'POST',
                    credentials: 'include',
                  })
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
      <div className="ide-workbench flex flex-1 min-h-0 min-w-0 flex-col md:flex-row">
        <div className="ide-rail-row flex shrink-0 md:contents">
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
              recentImports={recentImports}
              onOpenFile={(path) => void openFile(path)}
              onCreateFile={(dir) => void createFile(dir)}
              onCreateFolder={(dir) => void createFolder(dir)}
              onOpenFolder={() => void openSystemFolder()}
              onRename={(path) => void renameEntry(path)}
              onDelete={(path) => void deleteEntry(path)}
              onRefresh={() => void refreshTree()}
              onClearRecentImports={clearRecentImports}
              onToggle={() => setSidebarOpen(false)}
              onSelectView={setActiveView}
            />
          )}
        </div>

        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          {pendingExplanation && (
            <div className="mx-2 mt-2 rounded-lg border border-[#635bff]/35 bg-[#635bff]/10 px-3 py-2 text-xs text-white/85">
              <div className="font-medium text-white">
                I’ve written{' '}
                <span className="font-mono">
                  {baseName(pendingExplanation.path)}
                </span>
                . Should I explain the code and syntax line by line?
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    pushMessage(
                      'leo',
                      `Sure — I’ll explain ${baseName(pendingExplanation.path)} and its syntax.`,
                    )
                    void startExplanation(pendingExplanation)
                  }}
                  className="rounded bg-[#635bff] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#7c6cff]"
                >
                  Yes, explain
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingExplanation(null)
                    pushMessage(
                      'leo',
                      'Okay, I’ll skip the explanation. Tell me what to do next.',
                    )
                  }}
                  className="rounded border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
                >
                  No, continue
                </button>
                <span className="text-[11px] text-white/45">
                  You can also answer by voice or type “yes” / “no”.
                </span>
              </div>
            </div>
          )}
          {explanation && (
            <div className="mx-2 mt-2 rounded-lg border border-white/10 bg-[#252526] px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-white/90">
                    Code walkthrough:{' '}
                    <span className="font-mono">
                      {baseName(explanation.path)}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/45">
                    {explanation.loading
                      ? 'Preparing explanation…'
                      : explanation.error
                        ? 'Explanation issue'
                        : explanation.steps.length
                          ? `Step ${Math.min(explanation.index + 1, explanation.steps.length)} of ${explanation.steps.length} · lines ${explanation.steps[explanation.index]?.startLine}-${explanation.steps[explanation.index]?.endLine}`
                          : 'No steps'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={explanation.loading || explanation.index <= 0}
                    onClick={() =>
                      setExplanation(
                        (prev) =>
                          prev && {
                            ...prev,
                            index: Math.max(0, prev.index - 1),
                          },
                      )
                    }
                    className="rounded border border-white/10 px-2 py-1 text-white/70 disabled:opacity-40 hover:bg-white/5"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={
                      explanation.loading ||
                      explanation.index >= explanation.steps.length - 1
                    }
                    onClick={() =>
                      setExplanation(
                        (prev) =>
                          prev && {
                            ...prev,
                            index: Math.min(
                              prev.steps.length - 1,
                              prev.index + 1,
                            ),
                          },
                      )
                    }
                    className="rounded border border-white/10 px-2 py-1 text-white/70 disabled:opacity-40 hover:bg-white/5"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => setExplanation(null)}
                    className="rounded border border-white/10 px-2 py-1 text-white/50 hover:bg-white/5"
                    aria-label="Close explanation"
                  >
                    Close
                  </button>
                </div>
              </div>
              {explanation.error ? (
                <div className="mt-2 text-red-300/90">{explanation.error}</div>
              ) : explanation.loading ? (
                <div className="mt-2 text-white/55">
                  Leo is analyzing the code and syntax…
                </div>
              ) : explanation.steps[explanation.index] ? (
                <div className="mt-2 space-y-1.5 text-white/75">
                  <div className="font-medium text-[#c9c4ff]">
                    {explanation.steps[explanation.index].title}
                  </div>
                  <div>
                    <span className="text-white/45">What it does:</span>{' '}
                    {explanation.steps[explanation.index].what}
                  </div>
                  <div>
                    <span className="text-white/45">Why we wrote it:</span>{' '}
                    {explanation.steps[explanation.index].why}
                  </div>
                  {!!explanation.steps[explanation.index].syntax?.length && (
                    <div>
                      <span className="text-white/45">Syntax/concepts:</span>{' '}
                      {explanation.steps[explanation.index].syntax?.join(', ')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
          {pendingEdit && (
            <EditReview
              proposal={pendingEdit}
              busy={editBusy}
              dirty={pendingEditDirty}
              error={editError}
              onAccept={acceptPendingEdit}
              onReject={rejectPendingEdit}
            />
          )}
          <EditorArea
            tabs={openTabs}
            activeTab={activeTab}
            content={activeContent}
            onContentChange={updateContent}
            onSave={() => void saveFile()}
            onRun={() => void runFile()}
            onExplain={() => {
              if (!activeFile || !activeContent.trim()) return
              const language = activeFile.endsWith('.py')
                ? 'python'
                : activeFile.endsWith('.ts') || activeFile.endsWith('.tsx')
                  ? 'typescript'
                  : activeFile.endsWith('.js') || activeFile.endsWith('.jsx')
                    ? 'javascript'
                    : 'code'
              void startExplanation({
                path: activeFile,
                code: activeContent,
                language,
                goal: lastUserGoalRef.current || '',
              })
            }}
            onTabClick={(path) => void openFile(path)}
            onTabClose={closeTab}
            onCursorChange={(line, col) => setCursor({ line, col })}
            running={runningPath === activeFile}
            explainRange={activeExplainRange}
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
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Output & activity
                  </div>
                  <div className="text-[10px] text-white/30">
                    {logs.length} log entr{logs.length === 1 ? 'y' : 'ies'}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2.5 font-mono text-xs space-y-1">
                  {transcript && (
                    <div className="rounded-md border border-[#635bff]/25 bg-[#635bff]/10 px-2 py-1.5 text-[#d7d2ff] whitespace-pre-wrap">
                      <span className="mr-1 text-white/40">Voice:</span>
                      {transcript}
                    </div>
                  )}
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap leading-relaxed ${
                        log.startsWith('ERROR')
                          ? 'text-red-300/90'
                          : log.startsWith('>')
                            ? 'text-[#b9ffcf]/85'
                            : 'text-white/65'
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                  {!logs.length && !transcript && (
                    <div className="flex h-full min-h-[90px] items-center justify-center text-center text-white/35">
                      <div>
                        <div className="mb-1 text-sm text-white/55">
                          No output yet
                        </div>
                        <div>
                          Press <span className="text-white/60">Speak</span> or
                          run a file to see results here.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {panelTab === 'terminal' && (
              <div
                className="flex h-full min-h-0 flex-col gap-2 font-mono text-xs"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveLog((prev) =>
                      prev > 0 ? prev - 1 : logs.length - 1,
                    )
                  }
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveLog((prev) =>
                      prev < logs.length - 1 ? prev + 1 : 0,
                    )
                  }
                }}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold uppercase tracking-wider text-white/45">
                    Sandbox terminal
                  </span>
                  <span className="text-white/30">↑ ↓ navigate logs</span>
                </div>
                <div
                  className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-[#0d111a] p-2.5 text-white/70 space-y-0.5"
                  role="dialog"
                  aria-label="Terminal log"
                >
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap rounded px-1.5 py-0.5 ${
                        i === activeLog
                          ? 'bg-[#635bff]/20 text-white'
                          : log.startsWith('ERROR')
                            ? 'text-red-300/90'
                            : ''
                      }`}
                    >
                      <span className="mr-2 text-white/25 select-none">$</span>
                      {log}
                    </div>
                  ))}
                  {!logs.length && (
                    <div className="flex h-full min-h-[90px] items-center justify-center text-center text-white/35">
                      <div>
                        <div className="mb-1 text-sm text-white/55">
                          Terminal is ready
                        </div>
                        <div>
                          Run the active file to stream execution output here.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {panelTab === 'problems' && (
              <div className="h-full text-xs">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                  Problems
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-100/80">
                  <div className="font-medium text-emerald-200">
                    No problems detected
                  </div>
                  <div className="mt-1 text-[11px] text-emerald-100/55">
                    Lint, runtime, and command issues will appear here when
                    available.
                  </div>
                </div>
              </div>
            )}

            {panelTab === 'voice' && (
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <VoiceStatus voiceStatus={voiceStatus} />
                    <PipelineVisualizer
                      sttStatus={sttStatus}
                      agentStatus={agentStatus}
                      ttsStatus={ttsStatus}
                    />
                  </div>
                  <div className="text-[10px] text-white/35">
                    Speak, type, and review Leo&apos;s replies
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-2.5 space-y-2">
                  {messages.length === 0 && (
                    <div className="flex h-full min-h-[90px] items-center justify-center text-center text-xs text-white/35">
                      <div>
                        <div className="mb-1 text-sm text-white/55">
                          Voice & chat
                        </div>
                        <div>
                          Press <span className="text-white/60">Speak</span> or
                          type below to ask Leo to create, edit, or explain
                          code.
                        </div>
                      </div>
                    </div>
                  )}
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap shadow-sm ${
                          message.role === 'user'
                            ? 'bg-[#635bff]/25 text-white/90 border border-[#635bff]/30'
                            : 'bg-white/[0.06] text-white/75 border border-white/10'
                        }`}
                      >
                        <div className="mb-1 text-[9px] uppercase tracking-wider opacity-45">
                          {message.role === 'user' ? 'You' : 'Leo'}
                        </div>
                        {message.text}
                      </div>
                    </div>
                  ))}
                </div>

                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    await sendTextCommand()
                  }}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2"
                >
                  <input
                    value={commandInput}
                    onChange={(event) => setCommandInput(event.target.value)}
                    placeholder="Type a message for Leo…"
                    aria-label="Message Leo"
                    className="flex-1 rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-[#635bff] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!commandInput.trim()}
                    className="rounded-md bg-[#635bff] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#7c6cff] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
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

      {showSuggestion && panelTab !== 'voice' && (
        <ContextAwarePrompting onClose={() => setShowSuggestion(false)} />
      )}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory="true"
        directory=""
        multiple
        className="hidden"
        onChange={(e) => void onFolderInputChange(e)}
      />
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
            key: 'open-folder',
            label: 'Open Folder',
            description: 'Import a folder from your system into the workspace',
            run: () => void openSystemFolder(),
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
}: {
  voiceStatus: keyof typeof VOICE_STATUS_LABELS
  className?: string
}) {
  return (
    <div
      className={`p-2 bg-gray-900 text-white rounded mb-2 flex items-center gap-2 ${className || ''}`}
    >
      <svg
        className="w-3 h-3 text-green-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
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
    {
      label: 'Agent',
      active: agentStatus === 'processing',
      color: 'bg-amber-500',
    },
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
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">
          Cmd+K
        </kbd>
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">
          Esc
        </kbd>
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">
          Ctrl+Enter
        </kbd>
        <kbd className="bg-white/10 px-2 py-1 rounded text-xs text-gray-300">
          Ctrl+J
        </kbd>
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
                <span className="block font-medium text-white text-sm">
                  {command.label}
                </span>
                <span className="block text-xs text-white/40">
                  {command.description}
                </span>
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
      message:
        "I see you're viewing a React component. Would you like me to help extract props or generate unit tests?",
    },
    {
      trigger: 'recent-actions',
      message:
        'You just saved a file. Would you like to commit changes or preview the updated component?',
    },
    {
      trigger: 'selection',
      message:
        'Code is selected. I can help refactor, extract function, or generate documentation for this block.',
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
      <p className="px-3 py-2 text-xs leading-relaxed text-white/60">
        {prompt || contexts[0].message}
      </p>
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
