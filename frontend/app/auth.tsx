'use client'

import React, {
  useState,
  useEffect,
  createContext,
  useContext,
  ReactNode,
} from 'react'

interface AuthSession {
  user: { email: string }
}

interface AuthContextValue {
  session: AuthSession | null
  loggedIn: boolean
  signIn: (email: string) => Promise<boolean>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function readSession(): Promise<AuthSession | null> {
  if (typeof window === 'undefined') return null
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') return null
    const user = (data as { user?: unknown }).user
    if (!user || typeof user !== 'object') return null
    const email = (user as { email?: unknown }).email
    if (typeof email !== 'string' || !email) return null
    return { user: { email } }
  } catch {
    return null
  }
}

function Providers({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    readSession().then((s) => {
      setSession(s)
      setReady(true)
    })
  }, [])

  const signIn = async (email: string) => {
    if (!email.includes('@')) {
      window.alert('Enter a valid email address.')
      return false
    }
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: '' }),
      })
      const raw = await res.text()
      let data: { user?: { email?: string }; detail?: string } = {}
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {}
      } catch {
        // non-JSON response (e.g. proxy/gateway error page)
      }
      if (res.ok && data.user?.email) {
        setSession({ user: { email: data.user.email } })
        return true
      }
      const detail =
        data.detail ||
        (res.ok
          ? 'Sign-in failed: unexpected response.'
          : `Sign-in failed (HTTP ${res.status}).`)
      window.alert(detail)
      return false
    } catch (err) {
      window.alert(
        `Network error. Please try again.${err instanceof Error ? ` (${err.message})` : ''}`,
      )
      return false
    }
  }

  const signOut = () => {
    fetch('/api/auth/signout', { method: 'POST' }).catch(() => {})
    setSession(null)
    window.location.href = '/'
  }

  if (!ready) {
    return (
      <AuthContext.Provider
        value={{ session: null, loggedIn: false, signIn, signOut }}
      >
        {children}
      </AuthContext.Provider>
    )
  }

  return (
    <AuthContext.Provider
      value={{ session, loggedIn: session !== null, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within Providers')
  return ctx
}

export function useAuthStore() {
  return useAuthContext()
}

export function ProvidersWithAuth({ children }: { children: ReactNode }) {
  return React.createElement(Providers, null, children)
}
