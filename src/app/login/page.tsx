import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { availableAuthMethods } from '@/lib/auth.config'
import { LoginForm } from './login-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImageIcon, TriangleAlert } from 'lucide-react'

export const metadata = { title: 'Sign in · Image Host' }
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>
}) {
  const session = await auth()
  const params = await searchParams

  // Same-origin relative paths only — no open redirect.
  const requested = params.from ?? ''
  const callbackUrl =
    requested.startsWith('/') && !requested.startsWith('//') ? requested : '/'

  if (session) redirect(callbackUrl)

  const methods = availableAuthMethods()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100">
            <ImageIcon className="size-5 text-white dark:text-zinc-900" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Image Host
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Private. Authorised access only.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Sign in</CardTitle>
          </CardHeader>
          <CardContent>
            {methods.none ? (
              <div className="space-y-3">
                <div className="flex gap-2.5 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">No sign-in method configured</p>
                    <p className="text-amber-700 dark:text-amber-400">
                      Set <code className="font-mono text-xs">ADMIN_PASSWORD_HASH</code>{' '}
                      or the GitHub OAuth variables, then redeploy.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Generate a hash with{' '}
                  <code className="font-mono">npm run hash-password</code>. Verify what
                  loaded with <code className="font-mono">npm run check-env</code>.
                </p>
              </div>
            ) : (
              <LoginForm
                githubEnabled={methods.github}
                passwordEnabled={methods.password}
                callbackUrl={callbackUrl}
              />
            )}

            {params.error && (
              <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {params.error === 'AccessDenied'
                  ? 'That account is not authorised for this gallery.'
                  : 'Sign-in failed. Please try again.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
