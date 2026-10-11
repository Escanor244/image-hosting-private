/**
 * POST /api/refresh  { path }
 *
 * Drops the cached bytes and location for one image, for when it was replaced
 * directly on github.com. Accepts either a gallery session or the
 * `x-refresh-secret` header (for scripts/CI), compared in constant time.
 */

import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/lib/auth'
import { errorResponse } from '@/lib/api'
import { env } from '@/lib/env'
import { refreshImage } from '@/lib/gallery'
import { parseImagePath } from '@/lib/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function secretMatches(given: string | null): boolean {
  const expected = env.refreshSecret
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  const authorised =
    secretMatches(request.headers.get('x-refresh-secret')) || Boolean(await auth())
  if (!authorised) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json().catch(() => null)) as { path?: unknown } | null
    const path = typeof body?.path === 'string' ? parseImagePath(body.path.split('/')) : null
    if (!path) {
      return Response.json({ ok: false, error: 'Invalid path' }, { status: 400 })
    }
    await refreshImage(path)
    return Response.json({ ok: true, path })
  } catch (error) {
    return errorResponse(error)
  }
}
