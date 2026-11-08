'use client'

interface StatusBarProps {
  voiceStatus: string
  branch: string
  encoding: string
  lineCol: string
  onVoiceToggle: () => void
}

const VOICE_STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  listening: '#3b82f6',
  processing: '#f59e0b',
  disconnected: '#ef4444',
  ready: '#10b981',
}

export function StatusBar({
  voiceStatus,
  branch,
  encoding,
  lineCol,
  onVoiceToggle,
}: StatusBarProps) {
  const dotColor = VOICE_STATUS_COLORS[voiceStatus] || '#6b7280'

  return (
    <div className="ide-statusbar">
      <div className="ide-status-item">
        <span className="text-xs font-semibold">{branch}</span>
      </div>
      <div className="ide-status-item">
        <span className="text-xs">{encoding}</span>
        <span className="text-xs text-white/50 ml-1">·</span>
        <span className="text-xs">{lineCol}</span>
      </div>
      <div className="ide-spacer"></div>
      <div className="ide-status-item" onClick={onVoiceToggle} style={{ cursor: 'pointer' }}>
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: dotColor,
            boxShadow: `0 0 8px ${dotColor}`,
          }}
        />
        <span className="text-xs font-medium">
          {voiceStatus.charAt(0).toUpperCase() + voiceStatus.slice(1)}
        </span>
      </div>
      <div className="ide-status-item text-xs text-white/70" title="Voice: click to toggle">
        Voice
      </div>
    </div>
  )
}
