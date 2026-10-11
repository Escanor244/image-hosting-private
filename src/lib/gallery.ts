/**
 * Gallery operations. GitHub is the source of truth: listings are read live from
 * each store, and every change is a commit — so edits made directly on github.com
 * show up here, and edits made here show up on github.com.
 *
 * Writes are re-checked against the store's mode on the server. Hiding a button
 * in the UI is not the gate.
 */

import 'server-only'
import { revalidateTag } from 'next/cache'
import sharp from 'sharp'
import { driveEnabled, env } from './env'
import {
  clearLocation,
  deleteRecord,
  getRecord,
  getRecords,
  mongoConfigured,
  saveRecord,
} from './mongodb'
import {
  cacheTag,
  folderOf,
  joinPath,
  parseFolder,
  parseImagePath,
  slugify,
} from './paths'
import { forgetMiss } from './resolve'
import * as github from './sources/github'
import * as drive from './sources/drive'
import { getStore, listStores, type StoreSummary } from './stores'

/** Vercel rejects request bodies over 4.5 MB; leave headroom for multipart framing. */
export const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024
const MAX_DIMENSION = 3840
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'heif', 'tiff'])

export class GalleryError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

export type GalleryItem = {
  path: string
  folder: string
  source: 'github' | 'drive'
  store: string | null
  storeLabel: string
  writable: boolean
  size: number
  width: number | null
  height: number | null
  alt: string
  tags: string[]
  createdAt: string | null
  /** Another store earlier in lookup order has the same path; that one is served. */
  shadowed: boolean
}

export type StoreStatus = StoreSummary & { ok: boolean; error?: string; count: number }

export type GalleryListing = {
  items: GalleryItem[]
  folders: string[]
  stores: StoreStatus[]
  drive: { enabled: boolean; ok: boolean; error?: string }
}

function purge(path: string) {
  // expire: 0 → the next request fetches fresh bytes instead of serving stale ones.
  revalidateTag(cacheTag(path), { expire: 0 })
  forgetMiss(path)
}

function requireWritable(key: string): StoreSummary {
  const store = getStore(key)
  if (!store) throw new GalleryError('Unknown store', 404)
  if (store.mode !== 'rw') throw new GalleryError(`${store.label} is read-only`, 403)
  return store
}

// ── Listing ──────────────────────────────────────────────────────────────────

export async function listGallery(): Promise<GalleryListing> {
  const stores = listStores()

  const storeResults = await Promise.all(
    stores.map(async (store) => {
      try {
        return { store, entries: await github.listImages(store.key), error: undefined }
      } catch (error) {
        return { store, entries: [], error: (error as Error).message }
      }
    })
  )

  let driveEntries: drive.DriveEntry[] = []
  let driveError: string | undefined
  if (driveEnabled()) {
    try {
      driveEntries = await drive.listDriveImages()
    } catch (error) {
      driveError = (error as Error).message
    }
  }

  const seen = new Set<string>()
  const items: GalleryItem[] = []

  // Shadowing mirrors lookup order exactly: GitHub stores in key order, then Drive
  // (or the reverse if IMAGE_SOURCES says drive first).
  type Entry = Pick<GalleryItem, 'path' | 'size' | 'source' | 'store' | 'storeLabel' | 'writable'>
  const ordered: Entry[] = env.imageSources.flatMap((source): Entry[] =>
    source === 'github'
      ? storeResults.flatMap(({ store, entries }) =>
          entries.map((e) => ({
            path: e.path,
            size: e.size,
            source: 'github' as const,
            store: store.key,
            storeLabel: store.label,
            writable: store.mode === 'rw',
          }))
        )
      : driveEntries.map((e) => ({
          path: e.path,
          size: e.size,
          source: 'drive' as const,
          store: null,
          storeLabel: 'Drive',
          writable: false,
        }))
  )

  const records = await getRecords([...new Set(ordered.map((o) => o.path))])

  for (const entry of ordered) {
    const record = records.get(entry.path)
    items.push({
      ...entry,
      folder: folderOf(entry.path),
      width: record?.width ?? null,
      height: record?.height ?? null,
      alt: record?.alt ?? '',
      tags: record?.tags ?? [],
      createdAt: record?.createdAt?.toISOString() ?? null,
      shadowed: seen.has(entry.path),
    })
    seen.add(entry.path)
  }

  items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.path.localeCompare(b.path))

  const folders = [...new Set(items.map((i) => i.folder).filter(Boolean))].sort()

  return {
    items,
    folders,
    stores: storeResults.map(({ store, entries, error }) => ({
      ...store,
      ok: !error,
      error,
      count: entries.length,
    })),
    drive: { enabled: driveEnabled(), ok: !driveError, error: driveError },
  }
}

// ── Uniqueness ───────────────────────────────────────────────────────────────

/** True if the path exists in any store (optionally ignoring one store). */
async function pathTaken(path: string, ignoreStore?: string): Promise<boolean> {
  for (const store of listStores()) {
    if (store.key === ignoreStore) continue
    if (await github.fileSha(store.key, path)) return true
  }
  if (driveEnabled() && (await drive.findFile(path))) return true
  return false
}

async function freePath(folder: string, base: string, ext: string): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const name = n === 1 ? `${base}.${ext}` : `${base}-${n}.${ext}`
    const path = joinPath(folder, name)
    if (!(await pathTaken(path))) return path
  }
  throw new GalleryError('Could not find a free name — rename the file and retry', 409)
}

// ── Upload ───────────────────────────────────────────────────────────────────

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20)
}

export async function uploadImage(input: {
  bytes: Buffer
  originalName: string
  storeKey: string
  folder: string
  alt: string
  tags: string[]
}): Promise<GalleryItem> {
  const store = requireWritable(input.storeKey)

  const folder = parseFolder(input.folder)
  if (folder === null) {
    throw new GalleryError('Folder: lowercase letters, digits, - and _ only, max 3 levels')
  }
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    throw new GalleryError('File is larger than 4.4 MB after compression', 413)
  }

  // Decoding is the real type check: anything sharp can't parse as one of the
  // accepted formats is rejected, whatever its extension or declared MIME type.
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    meta = await sharp(input.bytes).metadata()
  } catch {
    throw new GalleryError('Not a supported image')
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new GalleryError(`Unsupported format: ${meta.format ?? 'unknown'}`)
  }

  // Re-encode everything to WebP: smaller, one format to serve, and it drops EXIF
  // (camera model, GPS) that photos would otherwise leak.
  const animated = (meta.pages ?? 1) > 1
  const { data, info } = await sharp(input.bytes, { animated })
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true })

  const path = await freePath(folder, slugify(input.originalName), 'webp')

  await github.putImage(store.key, path, data, `img: upload ${path}`)

  const createdAt = new Date()
  const alt = input.alt.trim().slice(0, 300)
  const tags = cleanTags(input.tags)
  await saveRecord(path, {
    source: 'github',
    store: store.key,
    size: data.length,
    width: info.width,
    height: animated && info.pageHeight ? info.pageHeight : info.height,
    alt,
    tags,
    uploadedVia: 'gallery',
    createdAt,
    resolvedAt: createdAt,
  })
  purge(path)

  return {
    path,
    folder,
    source: 'github',
    store: store.key,
    storeLabel: store.label,
    writable: true,
    size: data.length,
    width: info.width,
    height: info.height,
    alt,
    tags,
    createdAt: createdAt.toISOString(),
    shadowed: false,
  }
}

// ── Edit / move / delete ─────────────────────────────────────────────────────

export function requirePath(segments: string[] | undefined): string {
  const path = parseImagePath(segments)
  if (!path) throw new GalleryError('Invalid image path', 400)
  return path
}

export async function updateMeta(path: string, alt?: string, tags?: string[]): Promise<void> {
  if (!mongoConfigured()) {
    throw new GalleryError('Alt text and tags are stored in MongoDB — set MONGODB_URI', 409)
  }
  const record = await getRecord(path)
  await saveRecord(path, {
    source: record?.source,
    store: record?.store,
    ref: record?.ref,
    alt: alt !== undefined ? alt.trim().slice(0, 300) : record?.alt,
    tags: tags !== undefined ? cleanTags(tags) : record?.tags,
    width: record?.width,
    height: record?.height,
    size: record?.size,
    uploadedVia: record?.uploadedVia ?? 'github',
    createdAt: record?.createdAt ?? new Date(),
  })
}

/**
 * Rename and/or move between stores. Commit to the target first, then delete the
 * source — a failure in between leaves a duplicate, never a lost image.
 */
export async function moveImage(input: {
  path: string
  fromStore: string
  newPath: string
  toStore: string
}): Promise<string> {
  const from = requireWritable(input.fromStore)
  const to = requireWritable(input.toStore)

  const target = parseImagePath(input.newPath.split('/'))
  if (!target) throw new GalleryError('New path is not valid')
  if (target.split('.').pop() !== input.path.split('.').pop()) {
    throw new GalleryError('Keep the same file extension')
  }
  if (target === input.path && from.key === to.key) return target

  // Same path in a different store keeps the link; it only has to be free in the
  // destination. A new path has to be free everywhere except where it now lives.
  const taken =
    target === input.path
      ? Boolean(await github.fileSha(to.key, target))
      : await pathTaken(target)
  if (taken) throw new GalleryError('That path is already in use', 409)

  const source = await github.fetchImage(from.key, input.path, { fresh: true })
  if (!source) throw new GalleryError('Source image no longer exists', 404)

  await github.putImage(to.key, target, source.bytes, `img: move ${input.path} → ${target}`)
  await github.deleteImage(from.key, input.path, `img: move ${input.path} → ${target}`)

  const record = await getRecord(input.path)
  await saveRecord(target, {
    source: 'github',
    store: to.key,
    size: source.bytes.length,
    width: record?.width,
    height: record?.height,
    alt: record?.alt,
    tags: record?.tags,
    uploadedVia: record?.uploadedVia ?? 'github',
    createdAt: record?.createdAt ?? new Date(),
    resolvedAt: new Date(),
  })
  if (target !== input.path) await deleteRecord(input.path)

  purge(input.path)
  purge(target)
  return target
}

export async function removeImage(path: string, storeKey: string): Promise<void> {
  const store = requireWritable(storeKey)
  await github.deleteImage(store.key, path, `img: delete ${path}`)
  // The path may still exist in another store; drop only the location so the
  // next request re-resolves, and drop metadata only if nothing else has it.
  if (await pathTaken(path)) {
    await clearLocation(path)
  } else {
    await deleteRecord(path)
  }
  purge(path)
}

export async function refreshImage(path: string): Promise<void> {
  await clearLocation(path)
  purge(path)
}
