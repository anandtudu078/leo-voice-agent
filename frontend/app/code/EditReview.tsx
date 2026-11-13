'use client'

export type EditProposal = {
  path: string
  old_code: string
  new_code: string
  diff: string
  summary: string
  added: number
  removed: number
}

interface EditReviewProps {
  proposal: EditProposal
  busy: boolean
  dirty: boolean
  error: string | null
  onAccept: () => void
  onReject: () => void
}

function diffLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-white/35'
  if (line.startsWith('@@')) return 'bg-[#635bff]/10 text-[#c9c4ff]'
  if (line.startsWith('+')) return 'bg-emerald-500/10 text-[#9be8b0]'
  if (line.startsWith('-')) return 'bg-red-500/10 text-[#f4a6a6]'
  return 'text-white/55'
}

export function EditReview({
  proposal,
  busy,
  dirty,
  error,
  onAccept,
  onReject,
}: EditReviewProps) {
  const lines = proposal.diff.split('\n').filter((line, i, all) => {
    // Drop the trailing empty line from the joined diff.
    return !(i === all.length - 1 && line === '')
  })

  return (
    <section
      className="mx-2 mt-2 flex max-h-[46vh] shrink-0 flex-col overflow-hidden rounded-lg border border-[#635bff]/35 bg-[#1e1e2e]"
      aria-label={`Review edit for ${proposal.path}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-[#635bff]/20 px-1.5 py-0.5 font-semibold text-[#d7d2ff]">
              Review edit
            </span>
            <span
              className="truncate font-mono text-white/85"
              title={proposal.path}
            >
              {proposal.path}
            </span>
            <span className="text-emerald-300/80">+{proposal.added}</span>
            <span className="text-red-300/80">−{proposal.removed}</span>
          </div>
          <p className="mt-1 text-[11px] text-white/55">
            {proposal.summary ||
              'Review the proposed changes before applying them.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="rounded border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/75 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="rounded bg-[#635bff] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#7c6cff] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Applying…' : 'Accept edit'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-black/25 px-2 py-1.5 font-mono text-[11px] leading-relaxed">
        {lines.length ? (
          lines.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre px-1 ${diffLineClass(line)}`}
            >
              {line || ' '}
            </div>
          ))
        ) : (
          <div className="px-1 py-2 text-white/40">
            There are no textual differences to show.
          </div>
        )}
      </div>

      {(dirty || error) && (
        <div className="border-t border-white/10 px-3 py-2 text-[11px]">
          {dirty && (
            <div className="text-amber-300/90">
              This file has unsaved editor changes. Save or discard them before
              accepting the edit.
            </div>
          )}
          {error && <div className="text-red-300/90">{error}</div>}
        </div>
      )}

      <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-white/35">
        Nothing is written until you accept. You can also say “apply” or
        “reject”.
      </div>
    </section>
  )
}
