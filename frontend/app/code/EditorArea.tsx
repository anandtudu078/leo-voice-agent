'use client'

import { useEffect, useRef } from 'react'
import Editor from 'react-simple-code-editor'

import { highlightCode, languageForPath } from '@/lib/highlight'

interface Tab {
  path: string
  label: string
  dirty: boolean
}

interface ExplainRange {
  startLine: number
  endLine: number
}

interface EditorAreaProps {
  tabs: Tab[]
  activeTab: string | null
  content: string
  onContentChange: (code: string) => void
  onSave: () => void
  onRun: () => void
  onExplain?: () => void
  onTabClick: (path: string) => void
  onTabClose: (path: string) => void
  onCursorChange?: (line: number, col: number) => void
  running?: boolean
  disabled?: boolean
  explainRange?: ExplainRange | null
}

const EDITOR_LINE_HEIGHT = 20

export function EditorArea({
  tabs,
  activeTab,
  content,
  onContentChange,
  onSave,
  onRun,
  onExplain,
  onTabClick,
  onTabClose,
  onCursorChange,
  running = false,
  disabled = false,
  explainRange = null,
}: EditorAreaProps) {
  const paneRef = useRef<HTMLDivElement | null>(null)
  const lines = content.split('\n')
  const language = languageForPath(activeTab)

  useEffect(() => {
    if (!explainRange || !paneRef.current) return
    const top = 12 + (explainRange.startLine - 1) * EDITOR_LINE_HEIGHT
    const pane = paneRef.current
    const viewTop = pane.scrollTop
    const viewBottom = viewTop + pane.clientHeight
    const targetBottom =
      top +
      (explainRange.endLine - explainRange.startLine + 1) * EDITOR_LINE_HEIGHT
    if (top < viewTop + 24 || targetBottom > viewBottom - 24) {
      pane.scrollTo({ top: Math.max(0, top - 48), behavior: 'smooth' })
    }
  }, [explainRange])

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
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-1 shrink-0"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                <span className="truncate max-w-40">{tab.label}</span>
                {tab.dirty && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#635bff] shrink-0"
                    title="Unsaved changes"
                  />
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
            {running
              ? 'RUNNING'
              : language === 'text'
                ? 'EDIT'
                : language.toUpperCase()}
          </span>
          <button
            onClick={onSave}
            disabled={!activeTab || disabled}
            className="text-xs px-2.5 py-1 rounded bg-[#635bff] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#7c6cff] transition-colors"
            title="Save (Ctrl+S)"
          >
            Save
          </button>
          {onExplain && (
            <button
              onClick={onExplain}
              disabled={!activeTab || disabled}
              className="text-xs px-2.5 py-1 rounded bg-white/5 text-white/75 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10 hover:text-white transition-colors"
              title="Explain this code line by line"
            >
              Explain
            </button>
          )}
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
        <div className="ide-editor-pane" ref={paneRef}>
          <div className="ide-line-numbers" aria-hidden="true">
            {lines.map((_, i) => {
              const n = i + 1
              const active =
                !!explainRange &&
                n >= explainRange.startLine &&
                n <= explainRange.endLine
              return (
                <div
                  key={i}
                  className={active ? 'ide-line-explain-active' : undefined}
                >
                  {n}
                </div>
              )
            })}
          </div>
          <div className="flex-1 min-w-0 relative">
            {explainRange && (
              <div
                aria-hidden="true"
                className="ide-explain-highlight pointer-events-none absolute left-0 right-0"
                style={{
                  top: 12 + (explainRange.startLine - 1) * EDITOR_LINE_HEIGHT,
                  height:
                    (explainRange.endLine - explainRange.startLine + 1) *
                    EDITOR_LINE_HEIGHT,
                }}
              />
            )}
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
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[#635bff]/15 text-[#c9c4ff]">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Welcome to Leo Voice IDE</h2>
            <p className="mt-1 text-sm text-white/55">
              Open a file, import a folder from your system, or use voice to create and edit code.
            </p>
            <div className="mt-5 grid gap-2 text-left sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs font-medium text-white/80">1. Open or create</div>
                <div className="mt-1 text-[11px] text-white/45">Use Explorer to open files or import a local folder.</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs font-medium text-white/80">2. Speak or type</div>
                <div className="mt-1 text-[11px] text-white/45">Press Speak or chat with Leo to generate and edit code.</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs font-medium text-white/80">3. Run & iterate</div>
                <div className="mt-1 text-[11px] text-white/45">Save, run in sandbox, and refine with fast feedback.</div>
              </div>
            </div>
            <div className="mt-4 text-[11px] text-white/35">
              Shortcuts: <span className="rounded bg-white/5 px-1.5 py-0.5">Ctrl+S</span> save · <span className="rounded bg-white/5 px-1.5 py-0.5">Ctrl+Enter</span> run · <span className="rounded bg-white/5 px-1.5 py-0.5">Ctrl+J</span> panel
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
