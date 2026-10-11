/**
 * The embed guard — the only thing standing between a public URL and the bytes.
 *
 * An image is served only when BOTH hold:
 *
 *   1. `Sec-Fetch-Dest: image`. Browsers set this on <img> loads and set
 *      `document` when the URL is opened in a tab (new tab, incognito, pasted into
 *      the address bar). Page scripts cannot override it.
 *   2. The requesting page's origin (from `Referer`, else `Origin`) is in
 *      ALLOWED_ORIGINS / ALLOWED_ORIGIN_PATTERNS. No referrer → no image.
 *
 * Anything else gets a decoy: a random 404/403/410 that looks exactly like a
 * genuinely missing file, so a prober learns nothing about what exists.
 *
 * Limits, stated plainly: this stops hotlinking, direct opens and casual sharing.
 * It is not DRM — a visitor on an allowed page can still save what they see, and
 * a non-browser client can forge both headers.
 */

import 'server-only'
import { env } from './env'

const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function originOf(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin || origin === 'null') return false
  if (env.allowedOrigins.has(origin)) return true
  if (env.allowLocalhost && LOCALHOST.test(origin)) return true
  return env.allowedOriginPatterns.some((pattern) => pattern.test(origin))
}

export function isAllowedEmbed(request: Request): boolean {
  if (request.headers.get('sec-fetch-dest') !== 'image') return false

  const origin =
    originOf(request.headers.get('referer')) ??
    originOf(request.headers.get('origin'))

  return isAllowedOrigin(origin)
}

const DECOYS = [
  { status: 404, body: 'Not Found' },
  { status: 403, body: 'Forbidden' },
  { status: 410, body: 'Gone' },
] as const

/**
 * Used for every refusal AND every real miss, so the two are indistinguishable.
 * `no-store` keeps a decoy from being cached anywhere and later served to an
 * allowed embed.
 */
export function decoy(): Response {
  const pick = DECOYS[Math.floor(Math.random() * DECOYS.length)]
  return new Response(pick.body, {
    status: pick.status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

/** Best-effort client address for rate limiting. Vercel sets x-forwarded-for. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}
