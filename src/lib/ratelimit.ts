/**
 * In-memory rate limiter with lockout, for auth endpoints.
 *
 * The legacy build had no throttling anywhere, leaving the admin password freely
 * brute-forceable (audit H2). This is a single-instance limiter, which is sufficient
 * for a one-user panel; swap for Upstash Redis if the deployment ever scales out.
 */

import 'server-only'

type Bucket = {
  count: number
  firstAttempt: number
  lockedUntil: number | null
}

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

const globalForLimiter = globalThis as unknown as {
  _authBuckets?: Map<string, Bucket>
}

const buckets =
  globalForLimiter._authBuckets ??
  (globalForLimiter._authBuckets = new Map<string, Bucket>())

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number }

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket) return { allowed: true, remaining: MAX_ATTEMPTS - 1 }

  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    return { allowed: false, retryAfterMs: bucket.lockedUntil - now }
  }

  // Window expired — start fresh.
  if (now - bucket.firstAttempt > WINDOW_MS) {
    buckets.delete(key)
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 }
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    bucket.lockedUntil = now + LOCKOUT_MS
    return { allowed: false, retryAfterMs: LOCKOUT_MS }
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - bucket.count - 1 }
}

export function recordFailure(key: string): void {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now - bucket.firstAttempt > WINDOW_MS) {
    buckets.set(key, { count: 1, firstAttempt: now, lockedUntil: null })
    return
  }

  bucket.count += 1
  if (bucket.count >= MAX_ATTEMPTS) {
    bucket.lockedUntil = now + LOCKOUT_MS
  }
}

export function clearAttempts(key: string): void {
  buckets.delete(key)
}
