'use client'

import { useState, useRef, useCallback } from 'react'
import { Mic, MicOff, Terminal, Code2, Sparkles, X } from 'lucide-react'

type WsMessage =
  | { type: 'transcript'; transcript: string }
  | { type: 'plan'; action: string; tool: string; reason: string; steps: Array<{ tool: string; path?: string; code?: string }> }
  | { type: 'code'; code: string; patch: string }
  | { type: 'logs'; logs: string[] }
  | { type: 'error'; message: string }
  | { type: 'tts-ready'; message: string }

export default function LeoDashboard() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [codeOutput, setCodeOutput] = useState('// Leo is ready. Click the mic and speak.')
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioBlobRef = useRef<Blob | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/ws/process-voice`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setLoading(true)
      // Send language code metadata first
      ws.send(JSON.stringify({ language_code: 'en-IN' }))
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        switch (msg.type) {
          case 'transcript':
            setTranscript(msg.transcript)
            break
          case 'plan':
            setCodeOutput(`// Plan: ${msg.action} - ${msg.tool}\n// ${msg.reason}`)
            break
          case 'code':
            setCodeOutput(msg.code)
            break
          case 'logs':
            setLogs((prev) => [...prev, ...msg.logs])
            break
          case 'error':
            setCodeOutput(`// Error: ${msg.message}`)
            break
          case 'tts-ready':
            break
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      setLoading(false)
    }

    ws.onerror = () => {
      setLoading(false)
    }
  }, [])

  const startRecording = async () => {      audioChunksRef.current = []
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
        audioBlobRef.current = blob
        await sendAudioToBackend(blob)
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Microphone access denied:', err)
      alert('Please allow microphone access to use Leo.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const sendAudioToBackend = async (blob: Blob) => {
    setLoading(true)
    setCodeOutput('// Leo is listening, transcribing via Gnani AI...')

    // Try WebSocket first
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(blob)
      return
    }

    // Fallback: HTTP endpoint
    try {
      const res = await fetch('http://localhost:8000/api/process-voice', {
        method: 'POST',
        body: blob,
      })
      const data = await res.json()
      setTranscript(data.transcript || '')
      setCodeOutput(data.code || '// No output')
      setLogs([])
    } catch (error) {
      console.error('Error processing voice:', error)
      setCodeOutput('// Error connecting to backend. Is the FastAPI server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-4 md:p-6">
      <div className="max-w-5xl mx-auto flex-1 flex flex-col gap-4">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">LEO</h1>
              <p className="text-xs text-slate-400">Voice AI Engineer</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
        </header>

        {/* Voice Control Panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                Speak
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Speak naturally in English or Hinglish.
              </p>
            </div>
            <div className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono">
              {transcript || 'Awaiting voice command...'}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center py-6">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`relative group p-6 md:p-8 rounded-full transition-all duration-300 shadow-lg ${
                isRecording
                  ? 'bg-rose-600 hover:bg-rose-500 animate-bounce'
                  : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
            </button>
            <span className="text-xs text-slate-400 mt-3 font-medium">
              {isRecording ? 'Listening... click to stop' : 'Click to speak'}
            </span>
          </div>
        </div>

        {/* Code Output Panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 md:p-6 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Code2 className="w-4 h-4 text-indigo-400" />
              Generated Code
            </h2>
            <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-400 font-mono">
              Output
            </span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1 overflow-auto">
            <pre className="whitespace-pre-wrap font-mono text-sm text-emerald-300 leading-relaxed">
              {loading ? (
                <span className="text-indigo-400 animate-pulse">// Generating...</span>
              ) : (
                <>
                  {logs.map((log, i) => (
                    <div key={i} className="text-xs text-slate-500 mb-1">
                      {log}
                    </div>
                  ))}
                  {codeOutput}
                </>
              )}
            </pre>
          </div>
        </div>
      </div>
    </main>
  )
}
