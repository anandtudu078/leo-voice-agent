'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/app/auth'

// react-router is not used; the landing redirects via window.location.href

/**
 * Landing page.
 *
 * Clean project introduction with sign-in. After sign-in the user is taken
 * to /code, the code-space IDE where they write the project by voice.
 *
 * The authenticated redirect happens in useEffect (after mount) so that the
 * server and the client always render the same static HTML. This keeps
 * Next.js hydration happy: there is no server/client branch on the root
 * element that diverges between the server-rendered HTML and the client.
 */
export default function LandingPage() {
  const { session, signIn, signOut } = useAuthStore()
  const [email, setEmail] = useState('')
  const [showLogin, setShowLogin] = useState(false)

  // Redirect authenticated visitors to the code-space IDE after the
  // component has mounted (and hydrated). This is a client-side redirect
  // only; the server renders the same landing HTML for everyone.
  useEffect(() => {
    if (session && session.user) {
      window.location.href = '/code'
    }
  }, [session, session?.user])

  function submitSignIn(e: React.FormEvent) {
    e.preventDefault()
    signIn(email, '')
  }

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white flex flex-col">
      {/* ===== Top Navigation ===== */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 bg-[#0b0f19]/95 flex-wrap gap-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19v3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <rect x="9" y="2" width="6" height="13" rx="3" />
            </svg>
          </div>
          <span className="font-bold text-lg tracking-tight">Project Workspace</span>
        </div>

        <nav className="flex items-center gap-3 text-sm flex-wrap">
          {session ? (
            <div className="flex items-center gap-3">
              <span className="text-white/70 text-sm hidden sm:inline">{session.user.email}</span>
              <button
                    onClick={signOut}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/80 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
                    onClick={() => setShowLogin(true)}
              className="px-4 py-1.5 rounded-md bg-[#635bff] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Sign in
            </button>
          )}
        </nav>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative flex flex-col lg:flex-row items-center py-24 md:py-32 px-6 md:px-12 pt-20">
        <div className="flex-1 text-center lg:text-left max-w-xl">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight tracking-tight">
            Build your project{' '}
            <span className="text-[#635bff]">by voice</span>.
          </h1>
          <p className="mt-5 text-lg text-white/60">
            Open the code space. Describe what you want — a file, a feature, a fix —
            and the agent builds, tests, and ships it for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-4">
            <button
                    onClick={() => setShowLogin(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#635bff] text-white font-medium hover:opacity-90 transition-opacity"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19v3" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <rect x="9" y="2" width="6" height="13" rx="3" />
              </svg>
              Open code space
            </button>
            <a
              href="#features"
              className="px-5 py-3 rounded-lg border border-white/10 text-white/80 text-sm font-medium hover:bg-white/5 hover:text-white transition-colors"
            >
              Features
            </a>
          </div>
        </div>

        {showLogin && (
          <div className="flex-1 flex items-start justify-center px-4 pb-8">
            <form onSubmit={submitSignIn} className="w-full max-w-md">
              <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                <h2 className="text-lg font-semibold mb-4">Sign in to Project Workspace</h2>
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm text-white/60">
                    <span className="text-white/40">Email</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-md bg-black/20 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-[#635bff]"
                      placeholder="you@example.com"
                      autoFocus
                    />
                  </label>
                  <button
                    type="submit"
                    className="w-full px-4 py-2.5 rounded-md bg-[#635bff] text-white font-medium hover:opacity-90 transition-opacity"
                  >
                    Sign in
                  </button>
                </div>
              </div>
              <p className="text-center text-sm text-white/30 mt-3">
                No account needed — any valid email works (free forever).
              </p>
            </form>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-white/40 max-w-xs">
            <svg width="200" height="200" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="20" y="40" width="160" height="120" rx="8" />
              <path d="M20 40h160v16" />
              <path d="M20 90h160" />
              <path d="M20 140h80" />
              <path d="M20 140v60" />
              <path d="M100 140v60" />
              <path d="M140 140v60" />
            </svg>
            <p className="text-white/30 mt-4 text-sm">Code workspace (after sign in)</p>
          </div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="px-6 md:px-12 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold">How it works</h2>
            <p className="text-white/50 mt-2 text-sm">Four quick steps from idea to shipped code.</p>
          </div>

          <div className="mt-12 grid md:grid-cols-2 gap-6 max-w-3xl">
            {[
              {
                n: '01',
                title: 'Open the code space',
                body: 'Click Open code space after signing in. The IDE loads your workspace.',
              },
              {
                n: '02',
                title: 'Speak your change',
                body: 'Say what you want: "add a login form", "fix the bug in checkout.js". The agent listens.',
              },
              {
                n: '03',
                title: 'Agent writes the code',
                body: 'It reads the relevant files, writes the code, and shows it in the code space.',
              },
              {
                n: '04',
                title: 'Run and ship',
                body: 'The agent runs the test suite and pushes real changes to your project.',
              },
            ].map((f) => (
              <div key={f.n} className="p-5 rounded-lg border border-white/5 bg-white/3">
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-[#635bff] text-white flex items-center justify-center text-xs font-bold">
                    {f.n}
                  </span>
                  <h3 className="text-sm font-semibold">{f.title}</h3>
                </div>
                <p className="text-xs text-white/50 mt-2 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer id="footer" className="border-t border-white/5 px-6 md:px-12 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-white/40">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg bg-white flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19v3" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <rect x="9" y="2" width="6" height="13" rx="3" />
              </svg>
            </div>
            <span className="font-semibold">Project Workspace</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href="#features" className="hover:text-white/70 transition-colors">Features</a>
            <a href="#footer" className="hover:text-white/70 transition-colors">Terms</a>
            <a href="#footer" className="hover:text-white/70 transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
