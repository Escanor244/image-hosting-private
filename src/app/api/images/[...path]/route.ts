/**
 * PATCH  /api/images/<path>          { alt?, tags?, newPath?, fromStore?, toStore? }
 * DELETE /api/images/<path>?store=1
 */

import { z } from 'zod'
import { errorResponse, requireSession } from '@/lib/api'
import { moveImage, removeImage, requirePath, updateMeta } from '@/lib/gallery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ path: string[] }> }

const patchSchema = z.object({
  alt: z.string().max(300).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  newPath: z.string().max(300).optional(),
  fromStore: z.string().optional(),
  toStore: z.string().optional(),
})

export async function PATCH(request: Request, { params }: Context) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    let path = requirePath((await params).path)
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ ok: false, error: 'Invalid request' }, { status: 400 })
    }
    const body = parsed.data

    const moving =
      body.fromStore !== undefined &&
      (body.newPath !== undefined || body.toStore !== undefined)

    if (moving) {
      path = await moveImage({
        path,
        fromStore: body.fromStore!,
        newPath: body.newPath ?? path,
        toStore: body.toStore ?? body.fromStore!,
      })
    }

    if (body.alt !== undefined || body.tags !== undefined) {
      await updateMeta(path, body.alt, body.tags)
    }

    return Response.json({ ok: true, path })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const path = requirePath((await params).path)
    const store = new URL(request.url).searchParams.get('store') ?? ''
    await removeImage(path, store)
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
