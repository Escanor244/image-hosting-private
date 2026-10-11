/**
 * GET  /api/images — everything in every store, plus folders and store health
 * POST /api/images — multipart upload: file, store, folder, alt, tags
 */

import { errorResponse, requireSession } from '@/lib/api'
import { listGallery, MAX_UPLOAD_BYTES, uploadImage } from '@/lib/gallery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const denied = await requireSession()
  if (denied) return denied

  try {
    return Response.json({ ok: true, ...(await listGallery()) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: 'No file' }, { status: 400 })
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ ok: false, error: 'File too large' }, { status: 413 })
    }

    const item = await uploadImage({
      bytes: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      storeKey: String(form.get('store') ?? ''),
      folder: String(form.get('folder') ?? ''),
      alt: String(form.get('alt') ?? ''),
      tags: String(form.get('tags') ?? '').split(','),
    })

    return Response.json({ ok: true, item })
  } catch (error) {
    return errorResponse(error)
  }
}
