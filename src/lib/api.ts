/**
 * Shared plumbing for the gallery's API routes. The session itself is enforced by
 * src/proxy.ts; `requireSession` re-checks so a matcher mistake can't open a route.
 */

import 'server-only'
import { auth } from './auth'
import { GalleryError } from './gallery'
import { GitHubWriteError } from './sources/github'

export async function requireSession(): Promise<Response | null> {
  const session = await auth()
  return session ? null : Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export function errorResponse(error: unknown): Response {
  if (error instanceof GalleryError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status })
  }
  if (error instanceof GitHubWriteError) {
    const hint =
      error.status === 403 || error.status === 404
        ? ' — check the store token has Contents: Read and write on that repo'
        : ''
    return Response.json(
      { ok: false, error: `${error.message}${hint}` },
      { status: 502 }
    )
  }
  console.error('[api]', error)
  return Response.json({ ok: false, error: 'Something went wrong' }, { status: 500 })
}
