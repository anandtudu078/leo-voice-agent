'use client'

interface VoiceStatusProps {
  voiceStatus: string
}

const VOICE_STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  listening: 'Listening',
  processing: 'Processing',
  disconnected: 'Disconnected',
  ready: 'Live',
}

const VOICE_STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  listening: '#3b82f6',
  processing: '#f59e0b',
  disconnected: '#ef4444',
  ready: '#10b981',
}

export function VoiceStatus({ voiceStatus }: VoiceStatusProps) {
  const label = VOICE_STATUS_LABELS[voiceStatus] || voiceStatus
  const color = VOICE_STATUS_COLORS[voiceStatus] || '#6b7280'

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md border bg-white/5">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: voiceStatus === 'listening' || voiceStatus === 'processing' ? `0 0 8px ${color}` : 'none',
        }}
      />
      <span className="text-xs font-medium text-white">{label}</span>
    </div>
  )
}
