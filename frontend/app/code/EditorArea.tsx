'use client'

import { useState } from 'react'
import Editor from 'react-simple-code-editor'

interface Tab {
  path: string
  label: string
}

interface EditorAreaProps {
  tabs: Tab[]
  activeTab: string | null
  content: string
  onContentChange: (code: string) => void
  onSave: () => void
  onRun: () => void
  onTabClick: (path: string) => void
  onTabClose: (path: string) => void
  disabled?: boolean
}

export function EditorArea({
  tabs,
  activeTab,
  content,
  onContentChange,
  onSave,
  onRun,
  onTabClick,
  onTabClose,
  disabled = false,
}: EditorAreaProps) {
  const [lineNumbersHover, setLineNumbersHover] = useState(false)

  const activeLabel = tabs.find((t) => t.path === activeTab)?.label || 'untitled'

  return (
    <div className="ide-editor-area flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="ide-tabbar">
        {tabs.map((tab) => {
          const isActive = tab.path === activeTab
          return (
            <div
              key={tab.path}
              className={`ide-tab relative group ${isActive ? 'active' : ''}`}
              onClick={() => onTabClick(tab.path)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              {tab.label}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose(tab.path)
                }}
                className="ide-tab-close opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Close ${tab.label}`}
              >
                ×
              </button>
            </div>
          )
        })}
        {tabs.length === 0 && <div className="text-xs text-white/30 px-2">No open editors</div>}
      </div>

      {/* Editor + line numbers */}
      <div className="ide-editor-pane flex-1 flex min-h-0">
        <div className={`ide-line-numbers ${lineNumbersHover ? 'bg-[#2d2d2d]' : ''}`}>
          {content.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="flex-1 overflow-auto relative">
          <Editor
            value={content}
            onValueChange={onContentChange}
            highlight={(code) => <code className="language-javascript">{code}</code>}
            className="react-simple-code-editor"
            style={{
              fontFamily:
                'ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, monospace',
              fontSize: 13,
              color: '#a6e3a1',
              minHeight: '100%',
              outline: 'none',
              padding: '12px 14px',
              border: 'none',
              background: 'transparent',
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Editor toolbar overlay */}
      <div className="absolute top-0 left-0 right-0 p-2 pointer-events-none z-10 flex justify-between items-start">
        <div className="pointer-events-auto flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded ${
            disabled ? 'bg-[#635bff] text-white' : 'bg-white/5 text-white/60'
          }`}>
            {disabled ? 'RUN' : 'EDIT'}
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={onSave}
            disabled={!activeTab || disabled}
            className={`text-xs px-2.5 py-1 rounded bg-[#635bff] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#7c6cff] transition-colors`}
            title="Save (Ctrl+S)"
          >
            Save
          </button>
          <button
            onClick={onRun}
            disabled={!activeTab || disabled}
            className={`text-xs px-2.5 py-1 rounded bg-[#635bff] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#7c6cff] transition-colors`}
            title="Run (Ctrl+Enter)"
          >
            Run
          </button>
        </div>
      </div>
    </div>
  )
}
