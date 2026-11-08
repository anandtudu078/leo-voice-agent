'use client'

import React, { useState, createContext, useContext, ReactNode } from 'react'

interface AuthSession {
  user: { email: string }
}

interface AuthContextValue {
  session: AuthSession | null
  loggedIn: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signOut: () => void
}

interface SignInResult {
  user: { email: string }
}

function readSession(): AuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('freebuff_session')
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as { user?: unknown }
    if (!obj.user || typeof obj.user !== 'object') return null
    const email = (obj.user as { email?: unknown }).email
    if (typeof email !== 'string' || !email) return null
    return { user: { email } }
  } catch {
    return null
  }
}

function writeSession(email: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('freebuff_session', JSON.stringify({ user: { email } }))
}

function clearSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem('freebuff_session')
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface ProvidersProps {
  children: ReactNode
}

function Providers({ children }: ProvidersProps) {
  const [session, setSession] = useState<AuthSession | null>(readSession)

  const signIn = async (email: string, password: string) => {
    if (!email.includes('@')) {
      window.alert('Enter a valid email address.')
      return false
    }
    try {
      const res = await fetch('http://localhost:8000/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.user && typeof data.user.email === 'string') {
        writeSession(data.user.email)
        setSession({ user: { email: data.user.email } })
        return true
      }
      window.alert(data.detail || 'Invalid email or password.')
      return false
    } catch {
      window.alert('Network error. Please try again.')
      return false
    }
  }

  const signOut = () => {
    clearSession()
    setSession(null)
    window.location.href = '/'
  }

  return React.createElement(
    AuthContext.Provider,
    { value: { session, loggedIn: session !== null, signIn, signOut } },
    children
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
  return React.createElement(Providers, { children })
}
