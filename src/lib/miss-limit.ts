/**
 * Per-IP limit on lookups that find nothing.
 *
 * Only misses count: a visitor loading real images never touches this. Someone
 * scanning random names gets 30 real lookups per 10 minutes, then decoys without
 * any upstream call — so a scan can't burn the GitHub/Drive quota.
 *
 * In-memory and per-instance, like the auth limiter in ratelimit.ts. Good enough
 * as a quota guard; the negative cache does most of the work anyway.
 */

import 'server-only'

const WINDOW_MS = 10 * 60 * 1000
const MAX_MISSES = 30

type Bucket = { count: number; windowStart: number }

const globalForMissLimit = globalThis as unknown as { _imgMissBuckets?: Map<string, Bucket> }
const buckets = (globalForMissLimit._imgMissBuckets ??= new Map<string, Bucket>())

export function missLimited(ip: string): boolean {
  const bucket = buckets.get(ip)
  if (!bucket) return false
  if (Date.now() - bucket.windowStart > WINDOW_MS) {
    buckets.delete(ip)
    return false
  }
  return bucket.count >= MAX_MISSES
}

export function recordMiss(ip: string): void {
  const now = Date.now()
  const bucket = buckets.get(ip)
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now })
  } else {
    bucket.count += 1
  }

  if (buckets.size > 10_000) {
    for (const [key, b] of buckets) if (now - b.windowStart > WINDOW_MS) buckets.delete(key)
  }
}
