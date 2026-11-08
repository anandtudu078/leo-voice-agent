'use client'

import Editor from 'react-simple-code-editor'

import { highlightCode, languageForPath } from '@/lib/highlight'

interface Tab {
  path: string
  label: string
  dirty: boolean
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
  onCursorChange?: (line: number, col: number) => void
  running?: boolean
  disabled?: boolean
}

const EDITOR_LINE_HEIGHT = 20

export function EditorArea({
  tabs,
  activeTab,
  content,
  onContentChange,
  onSave,
  onRun,
  onTabClick,
  onTabClose,
  onCursorChange,
  running = false,
  disabled = false,
}: EditorAreaProps) {
  const lines = content.split('\n')
  const language = languageForPath(activeTab)

  const reportCursor = (element: HTMLTextAreaElement | HTMLDivElement) => {
    if (!onCursorChange || !(element instanceof HTMLTextAreaElement)) return
    const position = element.selectionStart ?? 0
    const before = element.value.slice(0, position)
    const line = before.split('\n').length
    const col = position - before.lastIndexOf('\n')
    onCursorChange(line, col)
  }

  return (
    <div className="ide-editor-area flex-1 min-h-0 min-w-0">
      {/* Tab bar with the file actions pinned right */}
      <div className="ide-tabbar">
        <div className="ide-tabbar-scroll flex-1">
          {tabs.map((tab) => {
            const isActive = tab.path === activeTab
            return (
              <div
                key={tab.path}
                className={`ide-tab relative group ${isActive ? 'active' : ''}`}
                onClick={() => onTabClick(tab.path)}
                title={tab.path}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1 shrink-0">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span className="truncate max-w-40">{tab.label}</span>
                {tab.dirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#635bff] shrink-0" title="Unsaved changes" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onTabClose(tab.path)
                  }}
                  className="ide-tab-close opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  aria-label={`Close ${tab.label}`}
                >
                  ×
                </button>
              </div>
            )
          })}
          {tabs.length === 0 && (
            <div className="flex items-center h-full px-2 text-[11px] text-white/25">
              No open editors
            </div>
          )}
        </div>

        <div className="ide-tabbar-actions">
          <span className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-white/40">
            {running ? 'RUNNING' : language === 'text' ? 'EDIT' : language.toUpperCase()}
          </span>
          <button
            onClick={onSave}
            disabled={!activeTab || disabled}
            className="text-xs px-2.5 py-1 rounded bg-[#635bff] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#7c6cff] transition-colors"
            title="Save (Ctrl+S)"
          >
            Save
          </button>
          <button
            onClick={onRun}
            disabled={!activeTab || disabled || running}
            className="text-xs px-2.5 py-1 rounded bg-[#3c3c3c] text-white/80 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#4a4a4a] hover:text-white transition-colors"
            title="Run in the sandbox (Ctrl+Enter)"
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {/* Gutter and code scroll together inside one pane */}
      {activeTab ? (
        <div className="ide-editor-pane">
          <div className="ide-line-numbers" aria-hidden="true">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            <Editor
              value={content}
              onValueChange={onContentChange}
              highlight={(code) => highlightCode(code, language)}
              className="react-simple-code-editor w-full"
              style={{
                fontFamily:
                  "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
                fontSize: 13,
                lineHeight: `${EDITOR_LINE_HEIGHT}px`,
                color: '#d4d4d4',
                minHeight: '100%',
                outline: 'none',
                padding: '12px 14px',
                border: 'none',
                background: 'transparent',
                whiteSpace: 'pre',
              }}
              onKeyUp={(event) => reportCursor(event.currentTarget)}
              onClick={(event) => reportCursor(event.currentTarget)}
              onKeyDown={(event) => {
                // Keep the editor's indentation consistent with Python.
                if (event.key === 'Tab') {
                  event.preventDefault()
                  const target = event.currentTarget as HTMLTextAreaElement
                  const start = target.selectionStart
                  const end = target.selectionEnd
                  const next = `${content.slice(0, start)}  ${content.slice(end)}`
                  onContentChange(next)
                  requestAnimationFrame(() => {
                    target.selectionStart = start + 2
                    target.selectionEnd = start + 2
                  })
                }
              }}
              disabled={disabled}
              textareaClassName="focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-white/30">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <p className="text-sm">No file open</p>
          <p className="text-xs">Pick a file in the Explorer, or speak a command.</p>
        </div>
      )}
    </div>
  )
}
