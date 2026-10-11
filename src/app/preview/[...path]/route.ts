/**
 * Gallery thumbnails: GET /preview/<path>?w=320&store=1
 *
 * Session-gated (src/proxy.ts) instead of embed-guarded, so the gallery's own
 * domain never needs to be in ALLOWED_ORIGINS. `store` picks which copy to show,
 * so a shadowed duplicate previews its own bytes, not the served one.
 */

import { requireSession } from '@/lib/api'
import { parseImagePath } from '@/lib/paths'
import { loadImage, tryLocation } from '@/lib/resolve'
import { imageResponse, parseWidth } from '@/lib/serve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => new Response('Not Found', { status: 404 })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const denied = await requireSession()
  if (denied) return denied

  const path = parseImagePath((await params).path)
  if (!path) return notFound()

  const url = new URL(request.url)
  const width = parseWidth(url.searchParams.get('w'))
  if (width === undefined) return notFound()

  try {
    const store = url.searchParams.get('store')
    const bytes = store
      ? await tryLocation(path, { source: 'github', store })
      : (await loadImage(path))?.bytes
    if (!bytes) return notFound()

    return await imageResponse(request, bytes, path, { width, maxAge: 300 })
  } catch (error) {
    console.error('[preview]', (error as Error).message)
    return notFound()
  }
}
