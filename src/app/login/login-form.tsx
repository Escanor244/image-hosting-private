'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

/** lucide-react dropped brand icons, so the GitHub mark is inlined. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function LoginForm({
  githubEnabled,
  passwordEnabled,
  callbackUrl,
}: {
  githubEnabled: boolean
  passwordEnabled: boolean
  callbackUrl: string
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'github' | 'password' | null>(null)
  // Password form is revealed on request when GitHub is the primary path.
  const [showPassword, setShowPassword] = useState(!githubEnabled)

  async function handlePassword(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy('password')

    const result = await signIn('credentials', {
      password,
      redirect: false,
      callbackUrl,
    })

    if (result?.error) {
      // Auth.js collapses provider errors; the specific reason (wrong password vs
      // rate limited) is deliberately not distinguished to the client.
      setError('Invalid credentials, or too many attempts. Try again shortly.')
      setBusy(null)
      setPassword('')
      return
    }

    window.location.href = result?.url ?? callbackUrl
  }

  return (
    <div className="space-y-4">
      {githubEnabled && (
        <Button
          type="button"
          className="w-full gap-2"
          disabled={busy !== null}
          onClick={() => {
            setBusy('github')
            void signIn('github', { callbackUrl })
          }}
        >
          {busy === 'github' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <GithubMark className="size-4" />
          )}
          Sign in with GitHub
        </Button>
      )}

      {githubEnabled && passwordEnabled && !showPassword && (
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          className="w-full text-center text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400"
        >
          Use password instead
        </button>
      )}

      {passwordEnabled && showPassword && (
        <>
          {githubEnabled && (
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-xs text-zinc-400">or</span>
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
          )}

          <form onSubmit={handlePassword} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus={!githubEnabled}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy !== null}
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full gap-2"
              variant={githubEnabled ? 'secondary' : 'default'}
              disabled={busy !== null || password.length === 0}
            >
              {busy === 'password' && <Loader2 className="size-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        </>
      )}

      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  )
}
