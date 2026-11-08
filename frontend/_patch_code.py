"""One-off patch script for frontend/app/code/page.tsx. Deleted after running."""

from pathlib import Path

p = Path("app/code/page.tsx")
text = p.read_text(encoding="utf-8")  # universal newlines -> "\n"

reps: list[tuple[str, str]] = []

# --- auth: use the shared store instead of a direct backend fetch -------------
reps.append(
    (
        """export default function CodeSpace() {
  // The backend now owns the session: it stores it in an HttpOnly cookie and
  // exposes /api/auth/me + /api/auth/signout. This component reads the same
  // session the backend knows about, so the IDE never relies on the
  // client's localStorage mirror anymore.
  const [user, setUser] = useState<{ email: string }>({ email: '' })""",
        """export default function CodeSpace() {
  // The backend owns the session in an HttpOnly cookie and exposes
  // /api/auth/me + /api/auth/signout. The auth provider reads it through
  // Next's /api proxy, so this page never calls the backend origin directly.
  const { session, signOut } = useAuthStore()
  const user = session?.user ?? { email: '' }""",
    )
)

reps.append(
    (
        """
  const [signOutFn, setSignOutFn] = useState<(() => void) | null>(() => null)
""",
        "",
    )
)

reps.append(
    (
        """  // The backend now owns the session: it stores it in an HttpOnly cookie and
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

""",
        "",
    )
)

reps.append(
    (
        """      <CodeSpaceShell
        user={user}
        signOut={signOutFn}
        voiceStatus={voiceStatus}
        setVoiceStatus={setVoiceStatus}
      />""",
        """      <CodeSpaceShell
        user={user}
        signOut={signOut}
        voiceStatus={voiceStatus}
        setVoiceStatus={setVoiceStatus}
        setSttStatus={setSttStatus}
        setAgentStatus={setAgentStatus}
        setTtsStatus={setTtsStatus}
      />""",
    )
)

reps.append(
    (
        """function CodeSpaceShell({
  user,
  signOut,
  voiceStatus,
  setVoiceStatus,
}: {
  user: { email: string }
  signOut: (() => void) | null
  voiceStatus: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'
  setVoiceStatus: (status: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready') => void
}) {""",
        """function CodeSpaceShell({
  user,
  signOut,
  voiceStatus,
  setVoiceStatus,
  setSttStatus,
  setAgentStatus,
  setTtsStatus,
}: {
  user: { email: string }
  signOut: (() => void) | null
  voiceStatus: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready'
  setVoiceStatus: (status: 'idle' | 'listening' | 'processing' | 'disconnected' | 'ready') => void
  setSttStatus: (status: 'idle' | 'listening' | 'error') => void
  setAgentStatus: (status: 'idle' | 'processing' | 'done' | 'error') => void
  setTtsStatus: (status: 'idle' | 'speaking' | 'error') => void
}) {""",
    )
)

# --- refs for the recorder ---------------------------------------------------
reps.append(
    (
        """  const socketRef = useRef<WebSocket | null>(null)
  socketRef.current = socket""",
        """  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  socketRef.current = socket""",
    )
)

# --- socket URL + lifecycle --------------------------------------------------
reps.append(
    (
        """  const connect = useCallback(() => {
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
    }""",
        """  const connect = useCallback(() => {
    // The voice backend is its own FastAPI process. Next proxies /api/* but
    // not WebSocket upgrades, so connect to it directly.
    const origin = process.env.NEXT_PUBLIC_BACKEND_ORIGIN || 'http://localhost:8000'
    const wsUrl = `${origin.replace(/^http/, 'ws')}/ws/process-voice`
    const ws = new WebSocket(wsUrl)
    setSocket(ws)
    socketRef.current = ws

    ws.onopen = () => {
      setConnections((c) => c + 1)
      setVoiceStatus('ready')
    }""",
    )
)

reps.append(
    (
        """    ws.onclose = () => {
      setConnections((c) => c - 1)
      setVoiceStatus('idle')
    }

    ws.onerror = () => {
      setConnections((c) => c - 1)
      setVoiceStatus('disconnected')
    }
  }, [transcript])""",
        """    ws.onclose = () => {
      setConnections((c) => Math.max(0, c - 1))
      setVoiceStatus('idle')
    }

    ws.onerror = () => {
      setConnections((c) => Math.max(0, c - 1))
      setVoiceStatus('disconnected')
    }
  }, [setVoiceStatus])

  // Open the voice socket once on mount and close it when the page unmounts.
  useEffect(() => {
    connect()
    return () => {
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [connect])""",
    )
)

# --- message type + handlers -------------------------------------------------
reps.append(
    (
        """        const msg = JSON.parse(event.data) as {
          type: string
          transcript?: string
          code?: string
          logs?: string[]
          speech?: string
          error?: string
          message?: string
        }""",
        """        const msg = JSON.parse(event.data) as {
          type: string
          transcript?: string
          text?: string
          code?: string
          content?: string
          path?: string
          logs?: string[]
          speech?: string
          error?: string
          message?: string
        }""",
    )
)

reps.append(
    (
        """        switch (msg.type) {
          case 'turn-started':
            // Agent started thinking — transition to processing
            setVoiceStatus('processing')
            break
          case 'waiting':
            // Agent says \"Thinking...\" — keep processing
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
            break""",
        """        switch (msg.type) {
          case 'ready':
            setVoiceStatus('ready')
            break
          case 'turn-started':
            // Agent started thinking — transition to processing
            setVoiceStatus('processing')
            setAgentStatus('processing')
            break
          case 'waiting':
            // Agent says \"Thinking...\" — keep processing
            setVoiceStatus('processing')
            setAgentStatus('processing')
            break
          case 'listening':
            // Agent finished its reply and is listening again
            setVoiceStatus('listening')
            setAgentStatus('done')
            setTtsStatus('idle')
            break
          case 'closed':
            // Agent closed the voice session
            setVoiceStatus('ready')
            break
          case 'transcript':
            setTranscript(msg.transcript || '')
            setVoiceStatus('ready')
            setSttStatus('idle')
            break
          case 'file':
            // A file requested with read_file arrived from the workspace.
            setContent(msg.content || '')
            setLineCount((msg.content || '').split('\\n').length)
            break
          case 'code':
            if (msg.code) setLogs((prev) => [...prev, `Agent: ${msg.code}`])
            break""",
    )
)

reps.append(
    (
        """          case 'speech':
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
            break""",
        """          case 'speech': {
            setTtsStatus('speaking')
            const base64 = msg.speech || ''
            if (base64) {
              try {
                const binary = atob(base64)
                const bytes = new Uint8Array(binary.length)
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                const blob = new Blob([bytes], { type: 'audio/mpeg' })
                const url = URL.createObjectURL(blob)
                const audio = new Audio(url)
                audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
                audio.play().catch(() => URL.revokeObjectURL(url))
              } catch {
                // ignore audio decode errors
              }
            }
            if (msg.text) setLogs((prev) => [...prev, `Agent: ${msg.text}`])
            break
          }
          case 'error':
            setLogs((prev) => [...prev, `ERROR: ${msg.error || ''}`])
            setVoiceStatus('disconnected')
            break""",
    )
)

# --- bootstrap must run once, not whenever the active file changes -----------
reps.append(
    (
        """    setTree([
      { path: 'main.py', kind: 'file', name: 'main.py' },
      { path: 'app.py', kind: 'file', name: 'app.py' },
      { path: 'README.md', kind: 'file', name: 'README.md' },
      { path: 'sandbox.py', kind: 'file', name: 'sandbox.py' },
    ])
    setFiles([...tree])
    // Open main.py and seed its content
    if (!activeFile) setActiveFile('main.py')
    setContent(starter)
    setLineCount(starter.split('\\n').length)
  }, [activeFile])

  useEffect(() => {
    bootstrapWorkspace()
  }, [bootstrapWorkspace])""",
        """    const starterFiles = [
      { path: 'main.py', kind: 'file' as const, name: 'main.py' },
      { path: 'app.py', kind: 'file' as const, name: 'app.py' },
      { path: 'README.md', kind: 'file' as const, name: 'README.md' },
      { path: 'sandbox.py', kind: 'file' as const, name: 'sandbox.py' },
    ]
    setTree(starterFiles)
    setFiles(starterFiles)
    // Seed the editor once; opening another file must not reset it.
    setActiveFile((current) => current ?? 'main.py')
    setContent((current) => current || starter)
    setLineCount((current) => current || starter.split('\\n').length)
  }, [])

  // Runs once: an empty dependency list keeps file opens from re-seeding it.
  useEffect(() => {
    bootstrapWorkspace()
  }, [bootstrapWorkspace])""",
    )
)

# --- recorder: actually stop the recorder and send the audio -----------------
reps.append(
    (
        """  const startRecording = async () => {
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
  }""",
        """  const startRecording = async () => {
    if (recording) return
    setLoading(true)
    setLogs((prev) => [...prev, '> Listening…'])
    setVoiceStatus('listening')
    setSttStatus('listening')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mediaRecorder = new MediaRecorder(stream)
      recorderRef.current = mediaRecorder
      const chunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }

      mediaRecorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (chunks.length === 0) {
          setLoading(false)
          setVoiceStatus('ready')
          setSttStatus('idle')
          return
        }
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const audio = typeof reader.result === 'string' ? reader.result : ''
          if (socketRef.current?.readyState === WebSocket.OPEN && audio) {
            socketRef.current.send(JSON.stringify({ type: 'audio', data: audio }))
          } else {
            setLogs((prev) => [...prev, 'ERROR: voice socket is not connected'])
          }
          setLoading(false)
          setSttStatus('idle')
        }
        reader.readAsDataURL(blob)
      }

      mediaRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
      setLoading(false)
      setRecording(false)
      setVoiceStatus('disconnected')
      setSttStatus('error')
      setLogs((prev) => [...prev, 'ERROR: microphone access denied'])
    }
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }""",
    )
)

# --- toolbar: give the voice flow a trigger ---------------------------------
reps.append(
    (
        """              <button
                onClick={() => setEditorMode('run')}
                className={`text-xs px-2 py-1 rounded ${editorMode === 'run' ? 'bg-[#635bff] text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                Run
              </button>
            </div>""",
        """              <button
                onClick={() => setEditorMode('run')}
                className={`text-xs px-2 py-1 rounded ${editorMode === 'run' ? 'bg-[#635bff] text-white' : 'text-white/40 hover:bg-white/5'}`}
              >
                Run
              </button>
              <button
                onClick={recording ? stopRecording : startRecording}
                className={`text-xs px-2 py-1 rounded ${recording ? 'bg-red-500 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
              >
                {recording ? 'Stop' : 'Speak'}
              </button>
            </div>""",
    )
)

missing = []
for old, new in reps:
    if old not in text:
        missing.append(old)
        continue
    text = text.replace(old, new, 1)

if missing:
    for m in missing:
        print("MISSING >>>", repr(m[:400]))
    raise SystemExit(f"{len(missing)} pattern(s) not found")

with open(p, "w", encoding="utf-8", newline="\r\n") as f:
    f.write(text)

print(f"page.tsx patched ({len(reps)} replacements)")
