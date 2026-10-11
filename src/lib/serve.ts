/**
 * Turns loaded bytes into an image response — shared by the public `/i/...`
 * route and the gallery's session-gated `/preview/...` route.
 *
 * Caching rule that matters most: `Cache-Control: private`, never `public`. A
 * public response would be stored by Vercel's CDN and handed to the next
 * requester — including the incognito tab the guard just refused.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { env } from './env'
import { contentTypeFor, extensionOf } from './paths'

// Vercel caps function responses at 4.5 MB. Anything bigger is re-encoded down.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const FALLBACK_WIDTH = 1920

export type ServeOptions = {
  width: number | null
  /** Browser cache lifetime. */
  maxAge: number
}

/** `?w=` must be one of IMAGE_WIDTHS. Returns undefined for an invalid value. */
export function parseWidth(value: string | null): number | null | undefined {
  if (value === null || value === '') return null
  const n = Number(value)
  return env.imageWidths.includes(n) ? n : undefined
}

async function transform(
  bytes: Buffer,
  path: string,
  width: number | null
): Promise<{ body: Buffer; contentType: string }> {
  const ext = extensionOf(path)
  const original = { body: bytes, contentType: contentTypeFor(path) }

  // SVG is served as-is: resizing is meaningless and rasterising changes it.
  if (ext === 'svg') return original

  const needsShrink = bytes.length > MAX_RESPONSE_BYTES
  if (!width && !needsShrink) return original

  const body = await sharp(bytes, { animated: ext === 'gif' || ext === 'webp' })
    .rotate()
    .resize({ width: width ?? FALLBACK_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer()

  return { body, contentType: 'image/webp' }
}

export async function imageResponse(
  request: Request,
  bytes: Buffer,
  path: string,
  { width, maxAge }: ServeOptions
): Promise<Response> {
  const etag = `"${createHash('sha1')
    .update(bytes)
    .update(String(width ?? 0))
    .digest('base64url')}"`

  const headers: Record<string, string> = {
    'Cache-Control': `private, max-age=${maxAge}`,
    Vary: 'Referer, Sec-Fetch-Dest, Cookie',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Robots-Tag': 'noindex, nofollow, noimageindex',
    // Neutralises an SVG with embedded script if it's ever opened as a document.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  }

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers })
  }

  const { body, contentType } = await transform(bytes, path, width)

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
  })
}
