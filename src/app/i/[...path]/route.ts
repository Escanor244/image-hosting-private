/**
 * Public image route: GET /i/<folder>/<file>?w=<width>
 *
 * Order matters — cheapest refusal first, so a refused request costs nothing:
 *   guard → path rules → width rule → miss rate limit → lookup → respond.
 * Every refusal and every real miss returns the same decoy.
 *
 * Not behind the session proxy (see src/proxy.ts matcher): this is the one route
 * meant for anonymous visitors, and its gate is the embed guard instead.
 */

import { clientIp, decoy, isAllowedEmbed } from '@/lib/guard'
import { missLimited, recordMiss } from '@/lib/miss-limit'
import { parseImagePath } from '@/lib/paths'
import { loadImage } from '@/lib/resolve'
import { imageResponse, parseWidth } from '@/lib/serve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BROWSER_CACHE_SECONDS = 86_400

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!isAllowedEmbed(request)) return decoy()

  const path = parseImagePath((await params).path)
  if (!path) return decoy()

  const width = parseWidth(new URL(request.url).searchParams.get('w'))
  if (width === undefined) return decoy()

  // A real visitor never misses, so an IP over the miss budget is scanning names.
  // It gets decoys for everything until its window expires.
  const ip = clientIp(request)
  if (missLimited(ip)) return decoy()

  let image
  try {
    image = await loadImage(path)
  } catch (error) {
    console.error('[i] load failed:', (error as Error).message)
    return decoy()
  }

  if (!image) {
    recordMiss(ip)
    return decoy()
  }

  try {
    return await imageResponse(request, image.bytes, path, {
      width,
      maxAge: BROWSER_CACHE_SECONDS,
    })
  } catch (error) {
    console.error('[i] transform failed:', (error as Error).message)
    return decoy()
  }
}
