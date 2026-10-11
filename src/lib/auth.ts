/**
 * The single authentication module (Node runtime).
 *
 * Everything that needs a session imports from here. The legacy build had two
 * implementations — one dead, one inline — signed with two different secrets that
 * disagreed with each other (audit H1). There is exactly one here.
 *
 * Extends the edge-safe config in `auth.config.ts` with the password provider,
 * which depends on native Argon2 and therefore cannot run on the Edge runtime.
 *
 * Two ways in:
 *   - GitHub OAuth, pinned to one account id. Inherits that account's 2FA.
 *   - Password, as break-glass if GitHub is unreachable or the account is lost.
 *
 * AUTH_SECRET signs sessions and is deliberately separate from any user credential
 * (audit C4: the legacy build used one value for both, so neither could be rotated
 * independently).
 */

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { verify } from '@node-rs/argon2'
import { authConfig, githubEnabled, passwordEnabled } from './auth.config'
import { checkRateLimit, recordFailure, clearAttempts } from './ratelimit'

/** Identical failure for every reason — no user enumeration, no timing tell. */
const GENERIC_FAILURE = 'Invalid credentials'

if (!githubEnabled && !passwordEnabled) {
  console.warn(
    '[auth] Neither AUTH_GITHUB_ID/SECRET nor ADMIN_PASSWORD_HASH is set. ' +
      'Sign-in cannot succeed. Run `npm run hash-password` and set ADMIN_PASSWORD_HASH.'
  )
} else if (!githubEnabled) {
  console.info('[auth] GitHub OAuth not configured; password sign-in only.')
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // The credentials provider is always registered, even without a hash — it fails
  // cleanly in that case, and it guarantees at least one provider exists. Auth.js
  // misbehaves with an empty providers array.
  providers: [
    ...authConfig.providers,

    Credentials({
      name: 'Password',
      credentials: {
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const password =
          typeof credentials?.password === 'string' ? credentials.password : ''

        // Keyed globally rather than per-IP: there is one user and one password,
        // and a global key cannot be bypassed by rotating source addresses.
        const key = 'password-login'

        const limit = checkRateLimit(key)
        if (!limit.allowed) {
          throw new Error(
            `Too many attempts. Try again in ${Math.ceil(
              limit.retryAfterMs / 60000
            )} minutes.`
          )
        }

        const hash = process.env.ADMIN_PASSWORD_HASH
        if (!hash || !password) {
          recordFailure(key)
          throw new Error(GENERIC_FAILURE)
        }

        let valid = false
        try {
          valid = await verify(hash, password)
        } catch {
          valid = false
        }

        if (!valid) {
          recordFailure(key)
          throw new Error(GENERIC_FAILURE)
        }

        clearAttempts(key)
        return { id: 'owner', name: 'Owner', email: null }
      },
    }),
  ],
})

/** Identity recorded in the `updatedBy` field on every write. */
export async function currentActor(): Promise<string | null> {
  const session = await auth()
  if (!session?.user) return null
  return session.user.name ?? 'owner'
}
