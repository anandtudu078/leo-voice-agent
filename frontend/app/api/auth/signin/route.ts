import { type NextRequest, NextResponse } from 'next/server'

/**
 * Demo sign-in endpoint.
 *
 * The project has no database yet, so any well-formed email address is
 * treated as a valid account, exactly like the project's "free forever,
 * funded by ads" promise. No password comparison is performed.
 *
 * On success the response sets an HTTP-only, Secure, SameSite=Lax session
 * cookie that the client mirrors into localStorage so the landing and
 * account pages can read the same session.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown }

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    // Keep the demo simple: a password is optional; the name is enough.
    const password = typeof body.password === 'string' ? body.password : ''

    if (!email) {
      return NextResponse.json({ detail: 'Email is required.' }, { status: 400 })
    }

    if (!email.includes('@')) {
      return NextResponse.json({ detail: 'Enter a valid email address.' }, { status: 400 })
    }

    // In a real app this would hit your database. The demo treats every
    // valid email as an existing account so sign-in can be verified in one
    // click.
    const user = { email }

    const cookie = `freebuff_session=${JSON.stringify({ user })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`

    const res = NextResponse.json({ user })
    res.cookies.set(
      'freebuff_session',
      JSON.stringify({ user }),
      {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
      }
    )

    return res
  } catch (error) {
    console.error('signin error:', error)
    return NextResponse.json({ detail: 'Something went wrong.' }, { status: 500 })
  }
}
