'use client'

interface PanelTab {
  id: string
  label: string
}

interface PanelProps {
  open: boolean
  onToggle: () => void
  activeTab: string
  onTabChange: (id: string) => void
  children: React.ReactNode
}

const PANEL_TABS: PanelTab[] = [
  { id: 'terminal', label: 'TERMINAL' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'problems', label: 'PROBLEMS' },
  { id: 'voice', label: 'VOICE' },
]

export function Panel({
  open,
  onToggle,
  activeTab,
  onTabChange,
  children,
}: PanelProps) {
  return (
    <div className={`ide-panel ${open ? 'open' : ''} flex-col`}>
      <div className="ide-panel-header flex items-center justify-between gap-2 px-2 py-1.5 border-b border-white/5">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onToggle}
            className="w-6 h-6 rounded flex items-center justify-center text-xs text-white/55 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={open ? 'Close panel' : 'Open panel'}
            aria-expanded={open}
            title={open ? 'Close panel (Ctrl+J)' : 'Open panel (Ctrl+J)'}
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
              {open ? (
                <polyline points="6 9 12 15 18 9" />
              ) : (
                <polyline points="18 15 12 9 6 15" />
              )}
            </svg>
          </button>
          <div className="ide-panel-tabs flex items-center min-w-0 overflow-x-auto">
            {PANEL_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`ide-panel-tab ${activeTab === t.id ? 'active' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden sm:block text-[10px] text-white/35 font-mono pr-1 whitespace-nowrap">
          Terminal & Voice · Ctrl+J
        </div>
      </div>
      <div className="ide-panel-content flex-1">{children}</div>
    </div>
  )
}
