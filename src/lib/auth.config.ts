/**
 * Edge-safe auth configuration.
 *
 * Middleware runs on the Edge runtime, which cannot load native modules. The
 * password provider depends on native Argon2, so it lives in `auth.ts` (Node
 * runtime) and this file holds everything the edge needs: the GitHub provider,
 * the callbacks, and session/cookie policy.
 *
 * This split is required by Next.js, not a stylistic choice — importing the
 * credentials provider here breaks the middleware build.
 *
 * Ported unchanged from portfolio-admin/src/lib/auth.config.ts (spec: docs/admin/03-application-flow.md §2).
 */

import type { NextAuthConfig } from 'next-auth'
import GitHub from 'next-auth/providers/github'

/**
 * GitHub OAuth is OPTIONAL. Registering the provider with undefined credentials
 * produces a broken sign-in button and confusing runtime errors, so it is only
 * registered when both values are present.
 *
 * With it unset, the gallery runs on the password provider alone — useful for local
 * development before an OAuth app exists.
 */
export const githubEnabled = Boolean(
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
)

/**
 * Whether a usable break-glass password is configured.
 *
 * Checks the shape, not just presence: a hash mangled by .env variable expansion
 * (unescaped `$` collapses `$argon2id$v=19$m=...` to `=19=19456,t=2,p=1`) is a
 * non-empty string that can never verify. Treating that as "configured" would show
 * a login form that always fails with no explanation.
 */
export const passwordEnabled =
  process.env.ADMIN_PASSWORD_HASH?.startsWith('$argon2') ?? false

/** What the login page should offer. */
export function availableAuthMethods() {
  return {
    github: githubEnabled,
    password: passwordEnabled,
    /** True when nothing is configured — sign-in cannot succeed. */
    none: !githubEnabled && !passwordEnabled,
  }
}

export const authConfig: NextAuthConfig = {
  providers: githubEnabled
    ? [
        GitHub({
          clientId: process.env.AUTH_GITHUB_ID!,
          clientSecret: process.env.AUTH_GITHUB_SECRET!,
        }),
      ]
    : [],

  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },

  pages: { signIn: '/login', error: '/login' },

  callbacks: {
    /**
     * The authorisation gate. A valid GitHub login is not sufficient — the account
     * id must match ALLOWED_GITHUB_ID. Every other GitHub account is rejected.
     */
    async signIn({ account, profile }) {
      if (account?.provider === 'github') {
        const allowed = process.env.ALLOWED_GITHUB_ID
        if (!allowed) {
          console.error('[auth] ALLOWED_GITHUB_ID is not set; rejecting sign-in')
          return false
        }
        const id = profile?.id ? String(profile.id) : null
        if (id !== allowed) {
          console.warn('[auth] rejected GitHub sign-in for unauthorised account')
          return false
        }
        return true
      }

      // The credentials provider has already authorised in its own `authorize`.
      return account?.provider === 'credentials'
    },

    async jwt({ token, account, profile }) {
      if (account?.provider === 'github' && profile) {
        token.method = 'github'
        token.login = typeof profile.login === 'string' ? profile.login : 'owner'
      } else if (account?.provider === 'credentials') {
        token.method = 'password'
        token.login = 'owner'
      }
      return token
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        // Used as the `updatedBy` audit field on every write.
        name: (token.login as string) ?? 'owner',
      }
      // @ts-expect-error augmenting the session with the sign-in method
      session.method = token.method ?? 'unknown'
      return session
    },
  },

  // Session state lives in a signed, httpOnly cookie — never in localStorage or
  // sessionStorage. The legacy gate was `sessionStorage.isAdmin === 'true'`,
  // settable from devtools (audit M1).
  //
  // The __Secure- prefix and secure flag require HTTPS, so they are production-only;
  // local dev runs over http and would otherwise never receive the cookie.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === 'production'
          ? '__Secure-authjs.session-token'
          : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  trustHost: true,
}
