/**
 * Session gate + security headers for the gallery.
 *
 * Two zones in one app:
 *   - `/i/*`  public images. Excluded from this proxy entirely (see matcher) —
 *             their gate is the embed guard in src/lib/guard.ts, not a session.
 *   - everything else is the private gallery and requires a session, except the
 *             login page, the Auth.js handler, and /api/refresh (which accepts a
 *             session OR its own shared secret, checked in the route).
 *
 * Pattern from portfolio-admin/src/proxy.ts.
 */

import { NextResponse, type NextRequest } from 'next/server'
import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'

// Edge-safe config only — importing `@/lib/auth` would pull in native Argon2.
const { auth } = NextAuth(authConfig)

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/refresh']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  )
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  )
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Previews are same-origin; blob: covers the upload queue's local thumbnails.
      "img-src 'self' blob: data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  )
  return response
}

export default auth((request: NextRequest & { auth: unknown }) => {
  const { pathname } = request.nextUrl

  if (isPublic(pathname)) {
    return withSecurityHeaders(NextResponse.next())
  }

  if (!request.auth) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/preview/')) {
      return withSecurityHeaders(
        NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
      )
    }

    const loginUrl = new URL('/login', request.nextUrl.origin)
    loginUrl.searchParams.set('from', pathname)
    return withSecurityHeaders(NextResponse.redirect(loginUrl))
  }

  return withSecurityHeaders(NextResponse.next())
})

export const config = {
  // `i/` is the public image route — never session-gated, never redirected.
  matcher: ['/((?!i/|_next/static|_next/image|favicon.ico).*)'],
}
