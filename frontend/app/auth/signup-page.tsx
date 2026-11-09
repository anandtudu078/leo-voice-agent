import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LogIn, UserPlus } from 'lucide-react'

export default function SignupPage({
  onSignup,
  setAuth,
}: {
  onSignup: (email: string) => void
  setAuth: (value: 'logging-in' | 'logged-in' | 'logged-out') => void
}) {
  const [email, setEmail] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError('Email is required')
      return
    }
    onSignup(email.trim())
    setAuth('logging-in')
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-4">
          <UserPlus className="mx-auto h-12 w-12 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">Leo Voice Agent</h2>
          <p className="text-muted-foreground">Create an account</p>
        </div>

        {error && (
          <div className="bg-destructive text-white rounded-md p-3 mb-4 animate-shake">
            <span className="flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              <span>{error}</span>
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={error ? true : false}
            required
          />
          <Button type="submit" disabled={error ? true : false}>
            {error ? 'Try again' : 'Sign Up'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <button
            onClick={() => setAuth('logged-out')}
            className="underline underline-offset-2 hover:text-primary"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  )
}
