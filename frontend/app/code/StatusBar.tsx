'use client'

interface StatusBarProps {
  voiceStatus: string
  branch: string
  encoding: string
  lineCol: string
  recording: boolean
  onVoiceToggle: () => void
}

const VOICE_STATUS_COLORS: Record<string, string> = {
  idle: '#9ca3af',
  listening: '#60a5fa',
  processing: '#fbbf24',
  disconnected: '#f87171',
  ready: '#34d399',
}

const VOICE_STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  listening: 'Listening',
  processing: 'Processing',
  disconnected: 'Disconnected',
  ready: 'Live',
}

export function StatusBar({
  voiceStatus,
  branch,
  encoding,
  lineCol,
  recording,
  onVoiceToggle,
}: StatusBarProps) {
  const dotColor = VOICE_STATUS_COLORS[voiceStatus] || VOICE_STATUS_COLORS.idle

  return (
    <div className="ide-statusbar">
      <div className="ide-status-item" title="Current branch">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <path d="M6 8.5v7M18 10.5c0 4-6 3-6 7" />
        </svg>
        <span className="text-xs font-semibold">{branch}</span>
      </div>

      <div className="ide-status-item">
        <span className="text-xs">{encoding}</span>
        <span className="text-xs text-white/50 mx-0.5">·</span>
        <span className="text-xs">{lineCol}</span>
      </div>

      <div className="ide-spacer" />

      <button
        onClick={onVoiceToggle}
        className="ide-status-item text-xs hover:bg-white/10 rounded px-1.5 py-0.5 transition-colors"
        title={recording ? 'Stop and send voice command' : 'Record a voice command'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
        {recording ? 'Stop & send' : 'Speak'}
      </button>

      <button
        onClick={onVoiceToggle}
        className="ide-status-item text-xs hover:bg-white/10 rounded px-1.5 py-0.5 transition-colors"
        title="Voice status — click to toggle recording"
      >
        <span
          className={`w-2 h-2 rounded-full ${recording ? 'animate-pulse' : ''}`}
          style={{
            backgroundColor: dotColor,
            boxShadow: voiceStatus === 'listening' || voiceStatus === 'processing' ? `0 0 8px ${dotColor}` : 'none',
          }}
        />
        <span className="text-xs font-medium">{VOICE_STATUS_LABELS[voiceStatus] || voiceStatus}</span>
      </button>
    </div>
  )
}
