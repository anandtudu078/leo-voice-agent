'use client'

import { useState } from 'react'

const ACTIVITY_ITEMS = [
  { id: 'explorer', label: 'Explorer', icon: 'explorer' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'source-control', label: 'Source Control', icon: 'source-control' },
  { id: 'run-debug', label: 'Run & Debug', icon: 'run-debug' },
  { id: 'extensions', label: 'Extensions', icon: 'extensions' },
  { id: 'voice', label: 'Voice', icon: 'voice', accent: true },
]

function iconSvg(kind: string) {
  switch (kind) {
    case 'explorer':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3-2 3v1a2 2 0 0 1 2 2z" />
        </svg>
      )
    case 'search':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      )
    case 'source-control':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20.5 14h-7l-2 4h5l-2-4v-2l2-4h5l2 4v2a2 2 0 0 1-2 2z" />
          <path d="M15 18v2a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2" />
        </svg>
      )
    case 'run-debug':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      )
    case 'extensions':
      return (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M16 6v6" />
          <path d="M8 6v6" />
        </svg>
      )
    case 'voice':
      return (
        <svg
          width="16"
          height="16"
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
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" />
      )
  }
}

export function ActivityBar({
  active,
  onSelect,
}: {
  active: string
  onSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <aside className="ide-activitybar w-12 shrink-0">
      {ACTIVITY_ITEMS.map((item) => {
        const isActive = active === item.id
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
            className={`ide-activitybar-item ${isActive ? 'active' : ''} ${
              item.accent ? 'text-[#8b83ff]' : ''
            }`}
            aria-label={item.label}
            aria-pressed={isActive}
            title={item.label}
          >
            {iconSvg(item.icon)}
          </button>
        )
      })}
    </aside>
  )
}
