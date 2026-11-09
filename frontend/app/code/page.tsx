'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

import { ActivityBar } from './ActivityBar'
import { SideBar } from './SideBar'
import { EditorArea } from './EditorArea'
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
// Code-space IDE – VS Code / PyCharm style shell, voice-powered.
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
  const [activeLog, setActiveLog] = useState(0)
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
  const [messages, setMessages] = useState<{ id: number; role: 'user' | 'leo'; text: string }[]>([])
  const [creationMode, setCreationMode] = useState<'none' | 'ask' | 'path'>('none')
  const [autoCommand, setAutoCommand] = useState<'createFile' | 'createFolder' | 'runFile' | null>(null)
  const [autoCommandPayload, setAutoCommandPayload] = useState<{path?: string, code?: string} | null>(null)
  const [folderSelectMode, setFolderSelectMode] = useState<'none' | 'ask' | 'chosen'>('none')
  const [commandInput, setCommandInput] = useState('')

  const messageIdRef = useRef(0)
  const offlineRef = useRef(false)
  const unmountingRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>(() => {})

  const pushMessage = useCallback((role: 'user' | 'leo', text: string) => {
    if (!text) return
    setMessages((prev) => [...prev.slice(-59), { id: ++messageIdRef.current, role, text }])
  }, [])

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording'))
      reader.readAsDataURL(blob)
    })

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
  const recorderRef = useRef<WavRecorder | null>(null)

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

  // FIXED: Cleanly closed the ternary block expression here
  const adoptFile = useCallback((path: string, content: string) => {
    setTabs((prev) =>
      prev.some((tab) => tab.path === path)
        ? prev.map((tab) => (tab.path === path ? { ...tab, content } : tab))
        : [...prev, { path, content, saved: content }]
    )
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#1c1c1c] text-[#e0e0e0] overflow-hidden selection:bg-blue-500/30">
      {/* Main Workspace Row */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Side Rail */}
        <ActivityBar
          activeView={activeView}
          setActiveView={setActiveView}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />

        {/* Primary Collapsible Navigation Tree */}
        {sidebarOpen && (
          <SideBar
            activeView={activeView}
            files={files}
            activeFile={activeFile}
            setActiveFile={setActiveFile}
            loadingTree={loadingTree}
          />
        )}

        {/* Editor Layout & Bottom Panel */}
        <div className="flex flex-col flex-1 overflow-hidden relative">
          <div className="flex-1 min-h-0 relative">
            <EditorArea
              tabs={openTabs}
              activeTab={activeTab}
              setActiveFile={setActiveFile}
              content={activeContent}
              cursor={cursor}
              setCursor={setCursor}
            />

            {/* Context Floating Voice Badge Status overlay */}
            <div className="absolute top-4 right-4 z-50">
              <VoiceStatus voiceStatus={voiceStatus} />
            </div>
          </div>

          {/* Bottom Diagnostics / AI Terminal Panel */}
          {panelOpen && (
            <Panel
              panelTab={panelTab}
              setPanelTab={setPanelTab}
              logs={logs}
