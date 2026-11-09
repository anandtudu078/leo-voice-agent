'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/app/auth'

/**
 * Landing page.
 *
 * A product-forward introduction to the voice workspace: what Leo does, how a
 * session goes, and a single call to action that opens the sign-in dialog.
 * Authenticated visitors are sent to /code after mount so the server-rendered
 * HTML never differs between signed-in and anonymous visitors.
 */
export default function LandingPage() {
  const { session, signIn, signOut } = useAuthStore()
  const [email, setEmail] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [year, setYear] = useState<number | null>(null)

  useEffect(() => {
    if (session && session.user) {
      window.location.href = '/code'
    }
  }, [session])

  // Keep the footer year current without calling Date during prerendering.

  useEffect(() => {
    const id = window.requestAnimationFrame(() =>
      setYear(new Date().getFullYear()),
    )

    return () => window.cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (!showLogin) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowLogin(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showLogin])

  function openLogin() {
    setError('')
    setShowLogin(true)
  }

  async function submitSignIn(event: React.FormEvent) {
    event.preventDefault()
    const value = email.trim()
    if (!value.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setSubmitting(true)
    const ok = await signIn(value)
    setSubmitting(false)
    if (ok) window.location.href = '/code'
    else setError('Could not sign in. Check the address and try again.')
  }

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white">
      {/* ===== Navigation ===== */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0f19]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#635bff] text-white shadow-lg shadow-[#635bff]/25">
              <BrandMark />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">
              Leo
            </span>
          </a>

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <a href="#product" className="transition-colors hover:text-white">
              Product
            </a>
            <a href="#features" className="transition-colors hover:text-white">
              Features
            </a>
            <a
              href="#how-it-works"
              className="transition-colors hover:text-white"
            >
              How it works
            </a>
          </nav>

          {session ? (
            <div className="flex items-center gap-3">
              <span className="hidden max-w-52 truncate text-sm text-white/50 sm:inline">
                {session.user.email}
              </span>
              <button
                onClick={signOut}
                className="rounded-lg border border-white/10 px-3.5 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/5 hover:text-white"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={openLogin}
              className="rounded-lg bg-[#635bff] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7c6cff]"
            >
              Sign in
            </button>
          )}
        </div>
      </header>{' '}
      {/* ===== Hero ===== */}
      <section id="top" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="landing-orb left-[-8%] top-[-6%] h-72 w-72 bg-[#635bff]"
          style={{ animation: 'landing-pulse-soft 9s ease-in-out infinite' }}
        />
        <div
          aria-hidden="true"
          className="landing-orb right-[-10%] top-[18%] h-64 w-64 bg-[#3b82f6] opacity-30"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(65%_55%_at_50%_-5%,rgba(99,91,255,0.28),transparent_72%)]"
        />
        <div
          aria-hidden="true"
          className="landing-grid pointer-events-none absolute inset-0 opacity-60"
        />

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-14 lg:grid-cols-[1.02fr_1.08fr] lg:gap-16 lg:pb-24 lg:pt-20">
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#635bff]/35 bg-[#635bff]/12 px-3.5 py-1.5 text-xs font-medium text-[#c4bfff] shadow-[0_0_0_1px_rgba(99,91,255,0.08)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8b83ff] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8b83ff]" />
              </span>
              Voice-first development workspace
            </span>

            <h1 className="mt-7 text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-[3.55rem]">
              Build software at the
              <span className="block bg-gradient-to-r from-[#c4bfff] via-[#9b93ff] to-[#635bff] bg-clip-text pb-1 text-transparent sm:inline sm:pb-0">
                {' '}
                speed of speech
              </span>
              <span className="sm:hidden">.</span>
              <span className="hidden sm:inline">.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/58 lg:mx-0 lg:text-lg">
              Leo is a code workspace you talk to. Describe a feature, a fix, or
              a whole file — the agent writes it, shows the diff in a real
              editor, and runs it in an isolated sandbox.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <button
                onClick={openLogin}
                className="group inline-flex items-center gap-2 rounded-xl bg-[#635bff] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[#635bff]/30 ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#746cff] hover:shadow-xl hover:shadow-[#635bff]/35"
              >
                <span className="transition-transform duration-200 group-hover:scale-110">
                  <MicIcon />
                </span>
                Start building free
              </button>
              <a
                href="#product"
                className="rounded-xl border border-white/12 bg-white/[0.03] px-5 py-3 text-sm font-medium text-white/75 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
              >
                See the workspace
              </a>
            </div>

            <div className="mt-9 grid grid-cols-1 gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 text-left backdrop-blur-sm sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/[0.07]">
              {[
                'No credit card',
                'Files persist per account',
                'Python & JavaScript sandbox',
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 px-1 py-1.5 text-xs text-white/55 sm:justify-center sm:px-3"
                >
                  <span className="shrink-0">
                    <CheckIcon />
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-float lg:pt-2">
            <WorkspacePreview onTry={openLogin} />
          </div>
        </div>
      </section>
      {/* ===== Product preview copy ===== */}
      <section
        id="product"
        className="relative border-y border-white/[0.06] bg-gradient-to-b from-white/[0.02] to-transparent"
      >
        <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                n: '01',
                title: 'One sentence in',
                body: 'Press Speak, say what you want, and stop. Leo transcribes it, plans the change, and edits the files that matter.',
              },
              {
                n: '02',
                title: 'A real IDE out',
                body: 'Browse folders, open tabs, edit by hand, save, and run. Everything you would expect from an editor, wired to the same workspace the agent uses.',
              },
              {
                n: '03',
                title: 'Output you can trust',
                body: 'Runs happen in a sandbox with a hard timeout. Read the output in the terminal panel before you keep the change.',
              },
            ].map((item) => (
              <article
                key={item.title}
                className="landing-card group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f1420]/80 p-6"
              >
                <div
                  aria-hidden="true"
                  className="absolute right-4 top-3 text-3xl font-semibold tracking-tight text-white/[0.04] transition-colors group-hover:text-[#635bff]/15"
                >
                  {item.n}
                </div>
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#635bff]/25 to-[#635bff]/5 text-xs font-semibold text-[#b9b3ff] ring-1 ring-[#635bff]/20">
                  {item.n}
                </div>
                <h2 className="text-base font-semibold text-white">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/52">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>{' '}
      {/* ===== Features ===== */}
      <section
        id="features"
        className="relative mx-auto max-w-6xl px-6 py-20 md:py-24"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-24 h-56 w-56 rounded-full bg-[#635bff]/10 blur-3xl"
        />
        <div className="relative grid gap-10 lg:grid-cols-[0.95fr_1.25fr] lg:items-start lg:gap-14">
          <div className="lg:sticky lg:top-24">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b83ff]">
              Built for the whole loop
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              Everything you need between an idea and working code
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/52 md:text-base">
              Voice is the fastest way in, but Leo never hides the code.
              Inspect, edit, and run exactly like a normal editor.
            </p>
            <div className="mt-6 hidden h-px w-24 bg-gradient-to-r from-[#635bff]/60 to-transparent lg:block" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                icon: <MicIcon />,
                title: 'Natural voice commands',
                body: 'Open files, change code, or ask for a new feature in plain language.',
              },
              {
                icon: <TreeIcon />,
                title: 'A real file tree',
                body: 'Create, rename, move, and delete files and folders without leaving the browser.',
              },
              {
                icon: <CodeIcon />,
                title: 'Editing that feels native',
                body: 'Tabs, syntax highlighting, dirty markers, and cursor position in the status bar.',
              },
              {
                icon: <PlayIcon />,
                title: 'Run in a sandbox',
                body: 'Execute Python and JavaScript with a 30-second limit and read the raw output.',
              },
              {
                icon: <TerminalIcon />,
                title: 'Terminal and output panels',
                body: 'Follow every command, save, and run in one place — errors included.',
              },
              {
                icon: <CommandIcon />,
                title: 'Keyboard-first shortcuts',
                body: 'Ctrl+S to save, Ctrl+Enter to run, Ctrl+J for the panel, Ctrl+K for commands.',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="landing-card group rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.045] to-white/[0.02] p-5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#635bff]/20 bg-[#635bff]/12 text-[#b9b3ff] shadow-[0_0_24px_-12px_rgba(99,91,255,0.8)] transition-transform duration-200 group-hover:scale-105">
                  {feature.icon}
                </div>
                <h3 className="mt-4 text-sm font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/48">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>{' '}
      {/* ===== How it works ===== */}
      <section
        id="how-it-works"
        className="relative border-t border-white/[0.06] bg-white/[0.015]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#635bff]/30 to-transparent"
        />
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b83ff]">
                How it works
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                Idea to running code in three steps
              </h2>
            </div>
            <button
              onClick={openLogin}
              className="self-start rounded-xl border border-white/12 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white/85 transition-all hover:-translate-y-0.5 hover:border-[#635bff]/35 hover:bg-[#635bff]/10 hover:text-white md:self-auto"
            >
              Open the workspace
            </button>
          </div>

          <div className="relative mt-12">
            <div
              aria-hidden="true"
              className="absolute left-0 right-0 top-[2.35rem] hidden h-px bg-gradient-to-r from-[#635bff]/10 via-[#635bff]/35 to-[#635bff]/10 md:block"
            />
            <ol className="grid gap-4 md:grid-cols-3 md:gap-5">
              {[
                {
                  n: '01',
                  title: 'Sign in',
                  body: 'Pick an email address. Leo provisions a private workspace for you on the server.',
                },
                {
                  n: '02',
                  title: 'Speak or type',
                  body: 'Say “add a health check endpoint”, or open a file and start editing by hand.',
                },
                {
                  n: '03',
                  title: 'Save and run',
                  body: 'Review the change, press Save, then Run to see the output in the terminal.',
                },
              ].map((step) => (
                <li
                  key={step.n}
                  className="landing-card group relative rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#141a2b] to-[#0f1420] p-6"
                >
                  <div className="flex items-center gap-3">
                    <span className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-xl bg-[#635bff] text-sm font-semibold text-white shadow-lg shadow-[#635bff]/25 ring-4 ring-[#0b0f19]">
                      {step.n}
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8b83ff]/80">
                      STEP {step.n}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/48">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      {/* ===== Command examples ===== */}
      <section className="relative mx-auto max-w-6xl overflow-hidden px-6 py-20 md:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#635bff]/8 blur-3xl"
        />
        <div className="relative grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8b83ff]">
              Say it, don&apos;t type it
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
              A few things you can ask for
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/52">
              Leo keeps the conversation in context, so follow-ups work the way
              you expect — “make it async”, “add a test”, “run it again”.
            </p>
          </div>

          <ul className="space-y-3">
            {[
              'Create a FastAPI route for /health and run it.',
              'Refactor utils.js into smaller functions.',
              'Add type hints to everything in main.py.',
              'Fix the failing test and explain the change.',
            ].map((command, i) => (
              <li
                key={command}
                className="landing-card flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-gradient-to-r from-white/[0.04] to-white/[0.02] px-4 py-3.5"
                style={{
                  marginLeft: i % 2 ? '0.75rem' : 0,
                  marginRight: i % 2 ? 0 : '0.75rem',
                }}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#635bff]/12 text-[#a79fff] ring-1 ring-[#635bff]/15">
                  <QuoteIcon />
                </span>
                <span className="text-sm leading-relaxed text-white/72">
                  {command}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {/* ===== CTA ===== */}
      <section className="px-6 pb-20 md:pb-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-[#635bff]/25 bg-gradient-to-br from-[#171d31] via-[#121827] to-[#0d1220] px-6 py-12 text-center shadow-[0_30px_80px_-40px_rgba(99,91,255,0.45)] sm:px-10 sm:py-14">
          <div
            aria-hidden="true"
            className="landing-grid pointer-events-none absolute inset-0 opacity-30"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_90%_at_50%_-10%,rgba(99,91,255,0.32),transparent_68%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-20 left-1/2 h-56 w-[28rem] -translate-x-1/2 rounded-full bg-[#635bff]/20 blur-3xl"
          />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
              Ready when you are
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl md:text-[2.1rem]">
              Your next feature is one sentence away
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/52 sm:text-[15px]">
              Sign in with any email to open a workspace. No install, no setup —
              the editor loads in your browser.
            </p>
            <button
              onClick={openLogin}
              className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-[#635bff] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#635bff]/30 ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#746cff] hover:shadow-xl hover:shadow-[#635bff]/35"
            >
              <span className="transition-transform duration-200 group-hover:scale-110">
                <MicIcon />
              </span>
              Open Leo
            </button>
          </div>
        </div>
      </section>
      {/* ===== Footer ===== */}
      <footer className="border-t border-white/5 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-white/40">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#635bff] text-white">
              <BrandMark />
            </span>
            <span className="font-medium text-white/70">Leo</span>
            <span className="hidden sm:inline">· voice workspace</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <a
              href="#features"
              className="transition-colors hover:text-white/70"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="transition-colors hover:text-white/70"
            >
              How it works
            </a>
            <span className="text-white/20">© {year ? `${year} ` : ''}Leo</span>
          </div>
        </div>
      </footer>
      {/* ===== Sign-in dialog ===== */}
      {showLogin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setShowLogin(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-title"
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#121724] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="signin-title" className="text-lg font-semibold">
                  Sign in to Leo
                </h2>
                <p className="mt-1 text-xs text-white/40">
                  Your workspace is created on first sign-in.
                </p>
              </div>
              <button
                onClick={() => setShowLogin(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close sign-in dialog"
              >
                ×
              </button>
            </div>

            <form onSubmit={submitSignIn} className="mt-5 space-y-3">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-white/50"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoFocus
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-[#635bff] focus:outline-none focus:ring-1 focus:ring-[#635bff]/40"
              />
              {error && <p className="text-xs text-[#f48771]">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[#635bff] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#7c6cff] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Opening workspace…' : 'Continue'}
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-white/30">
              Demo sign-in: any valid email address works. No password required.
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

/* -------------------------------------------------------------------------- */
/* Workspace preview                                                          */
/* -------------------------------------------------------------------------- */

function WorkspacePreview({ onTry }: { onTry: () => void }) {
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div
        aria-hidden="true"
        className="absolute -inset-6 rounded-[28px] bg-[#635bff]/10 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#1e1e1e] shadow-2xl shadow-black/50">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-black/40 bg-[#323233] px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 truncate text-[11px] text-white/40">
            leo — main.py
          </span>
          <span className="ml-auto flex items-center gap-1.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live
          </span>
        </div>

        <div className="flex">
          {/* Mini explorer */}
          <div className="hidden w-32 shrink-0 border-r border-black/40 bg-[#252526] py-2 text-[11px] text-white/55 sm:block">
            <div className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-wider text-white/30">
              Explorer
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 text-white/60">
              ▾ src
            </div>
            <div className="bg-[#37373d] px-4 py-0.5 text-white">main.py</div>
            <div className="px-4 py-0.5">utils.py</div>
            <div className="px-2 py-0.5">tests</div>
            <div className="px-2 py-0.5">README.md</div>
          </div>

          {/* Code */}
          <div className="min-w-0 flex-1 bg-[#1e1e1e]">
            <div className="flex items-center gap-1 border-b border-black/30 px-2 text-[11px]">
              <span className="border-b-2 border-[#635bff] px-2 py-1.5 text-white/85">
                main.py
              </span>
              <span className="px-2 py-1.5 text-white/35">utils.py</span>
            </div>
            <pre className="overflow-hidden px-3 py-2.5 font-mono text-[11px] leading-[1.6] text-[#d4d4d4]">
              <span className="syn-comment">
                # Describe the change, or edit by hand
              </span>
              {'\n'}
              <span className="syn-keyword">from</span> fastapi{' '}
              <span className="syn-keyword">import</span> FastAPI{'\n\n'}
              app = <span className="syn-function">FastAPI</span>(){'\n\n'}
              <span className="syn-keyword">@app</span>.
              <span className="syn-function">get</span>(
              <span className="syn-string">&quot;/health&quot;</span>){'\n'}
              <span className="syn-keyword">def</span>{' '}
              <span className="syn-function">health</span>():{'\n'}
              {'    '}
              <span className="syn-keyword">return</span> {'{'}
              <span className="syn-string">&quot;status&quot;</span>:{' '}
              <span className="syn-string">&quot;ok&quot;</span>
              {'}\n'}
            </pre>
            <div className="border-t border-black/30 bg-[#2d2d2d] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-white/50">
              <span className="text-emerald-400">$ leo run main.py</span>
              <br />
              <span className="text-white/60">
                INFO: Uvicorn running on http://127.0.0.1:8000
              </span>
              <br />
              <span className="text-white/35">GET /health → 200 OK</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-black/40 bg-[#007acc] px-3 py-1 text-[10px] text-white/90">
          <span>main · Python</span>
          <span>Ln 8, Col 1</span>
        </div>
      </div>

      {/* Voice command card */}
      <div className="absolute -bottom-8 -left-3 w-[230px] rounded-lg border border-white/10 bg-[#121724] p-3 shadow-xl shadow-black/40 sm:-left-6">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-[#a79fff]">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#635bff]/20">
            <MicIcon />
          </span>
          Listening
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-white/75">
          “Add a health check endpoint and run it.”
        </p>
        <div className="mt-2 flex items-end gap-0.5" aria-hidden="true">
          {[6, 10, 4, 8, 12, 5, 9, 3, 7].map((height, index) => (
            <span
              key={index}
              className="w-1 rounded-full bg-[#635bff]/70"
              style={{ height }}
            />
          ))}
        </div>
      </div>

      <button
        onClick={onTry}
        className="absolute -right-2 -top-4 rounded-lg border border-white/10 bg-[#121724]/95 px-3 py-1.5 text-[11px] font-medium text-white/70 shadow-lg backdrop-blur transition-colors hover:text-white sm:-right-4"
      >
        Try it live →
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

function BrandMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19v3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="13" rx="3" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg
      width="15"
      height="15"
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
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-400/80"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function TreeIcon() {
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
      <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z" />
    </svg>
  )
}

function CodeIcon() {
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
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function PlayIcon() {
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
}

function TerminalIcon() {
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
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function CommandIcon() {
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
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
    </svg>
  )
}

function QuoteIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
    </svg>
  )
}
