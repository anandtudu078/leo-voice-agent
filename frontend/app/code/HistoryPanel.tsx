'use client'

export type EditHistoryEntry = {
  id: number
  path: string
  summary: string
  created_at: string | null
  undone_at: string | null
  added: number
  removed: number
}

interface HistoryPanelProps {
  entries: EditHistoryEntry[]
  path: string
  loading: boolean
  error: string | null
  signedIn: boolean
  onRestore: (revisionId: number) => void
  onClose: () => void
}

function formatWhen(value: string | null): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function HistoryPanel({
  entries,
  path,
  loading,
  error,
  signedIn,
  onRestore,
  onClose,
}: HistoryPanelProps) {
  return (
    <section
      className="mx-2 mt-2 flex max-h-[36vh] shrink-0 flex-col overflow-hidden rounded-lg border border-white/15 bg-[#1e1e2e]"
      aria-label={`Edit history for ${path || 'the workspace'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-white/80">
              Edit history
            </span>
            {path && (
              <span className="truncate font-mono text-white/70" title={path}>
                {path}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-white/45">
            Latest applied agent edits, newest first.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/70 hover:bg-white/10"
        >
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="px-3 py-3 text-[11px] text-white/45">
            Loading revisions…
          </div>
        )}
        {error && (
          <div className="px-3 py-3 text-[11px] text-red-300/90">{error}</div>
        )}
        {!signedIn && (
          <div className="px-3 py-3 text-[11px] text-white/45">
            Sign in to keep and restore edit history.
          </div>
        )}
        {signedIn && !loading && !error && entries.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-white/45">
            No agent edits recorded for this file yet.
          </div>
        )}

        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start justify-between gap-3 border-b border-white/5 px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] text-white/40">
                <span>{formatWhen(entry.created_at)}</span>
                {entry.undone_at && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200/80">
                    undone
                  </span>
                )}
              </div>
              <div
                className="mt-0.5 truncate text-xs text-white/80"
                title={entry.summary}
              >
                {entry.summary}
              </div>
              <div className="mt-0.5 flex gap-2 text-[10px]">
                <span className="text-emerald-300/80">+{entry.added}</span>
                <span className="text-red-300/80">−{entry.removed}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRestore(entry.id)}
              disabled={loading}
              className="shrink-0 rounded border border-[#635bff]/35 bg-[#635bff]/15 px-2.5 py-1 text-xs text-[#d7d2ff] hover:bg-[#635bff]/25 disabled:cursor-not-allowed disabled:opacity-40"
              title="Review a diff back to the version before this edit"
            >
              Restore
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-white/35">
        Restoring opens a diff for review. Nothing is written until you accept.
      </div>
    </section>
  )
}
