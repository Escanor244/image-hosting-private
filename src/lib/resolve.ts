/**
 * Path → bytes, across every configured source.
 *
 *   1. Negative cache (memory, then Mongo): a path recently found nowhere is
 *      refused without touching GitHub or Drive.
 *   2. Mongo mapping: if we know which store holds the path, try it first.
 *   3. Otherwise walk IMAGE_SOURCES in order — every GitHub store in key order,
 *      then Drive roots — first hit wins, and the mapping is saved.
 *   4. Found nowhere → negative-cache it.
 *
 * Links never name a store, so moving a file between repos keeps its URL working:
 * the stale mapping misses, the walk finds the new home, the mapping is rewritten.
 */

import 'server-only'
import { env } from './env'
import { listStores } from './stores'
import * as github from './sources/github'
import * as drive from './sources/drive'
import {
  clearLocation,
  getRecord,
  saveMiss,
  saveRecord,
  type ImageRecord,
} from './mongodb'

const MISS_TTL_SECONDS = 600
// Memory entries are per-instance and can't be cleared by an upload on another
// instance, so they live much shorter than the Mongo row the upload does clear.
const MEMORY_MISS_MS = 60_000

const globalForMisses = globalThis as unknown as { _imgMisses?: Map<string, number> }
const misses = (globalForMisses._imgMisses ??= new Map<string, number>())

export type Location = { source: 'github'; store: string } | { source: 'drive'; ref: string }

export type LoadedImage = { bytes: Buffer; location: Location }

function rememberMiss(path: string) {
  misses.set(path, Date.now() + MEMORY_MISS_MS)
  if (misses.size > 5000) {
    // Unbounded growth would let a scan of random names eat instance memory.
    const now = Date.now()
    for (const [key, until] of misses) if (until < now) misses.delete(key)
    if (misses.size > 5000) misses.clear()
  }
}

export function forgetMiss(path: string) {
  misses.delete(path)
}

function isMemoryMiss(path: string): boolean {
  const until = misses.get(path)
  if (!until) return false
  if (until < Date.now()) {
    misses.delete(path)
    return false
  }
  return true
}

function knownLocation(record: ImageRecord | null): Location | null {
  if (!record || record.missing) return null
  if (record.source === 'github' && record.store) return { source: 'github', store: record.store }
  if (record.source === 'drive' && record.ref) return { source: 'drive', ref: record.ref }
  return null
}

/** Read from one specific place — the gallery previews each store's own copy. */
export async function tryLocation(path: string, location: Location): Promise<Buffer | null> {
  if (location.source === 'github') {
    if (!listStores().some((s) => s.key === location.store)) return null
    return (await github.fetchImage(location.store, path))?.bytes ?? null
  }
  return (await drive.fetchFile(location.ref, path))?.bytes ?? null
}

/** Walk every source in order. Errors in one store don't hide the others. */
async function search(path: string, skip?: Location): Promise<LoadedImage | null> {
  for (const source of env.imageSources) {
    if (source === 'github') {
      for (const store of listStores()) {
        if (skip?.source === 'github' && skip.store === store.key) continue
        try {
          const found = await github.fetchImage(store.key, path)
          if (found) return { bytes: found.bytes, location: { source: 'github', store: store.key } }
        } catch (error) {
          console.warn(`[resolve] store ${store.key}: ${(error as Error).message}`)
        }
      }
    } else {
      try {
        const id = await drive.findFile(path)
        if (id && !(skip?.source === 'drive' && skip.ref === id)) {
          const found = await drive.fetchFile(id, path)
          if (found) return { bytes: found.bytes, location: { source: 'drive', ref: id } }
        }
      } catch (error) {
        console.warn(`[resolve] drive: ${(error as Error).message}`)
      }
    }
  }
  return null
}

export async function loadImage(path: string): Promise<LoadedImage | null> {
  if (isMemoryMiss(path)) return null

  const record = await getRecord(path)
  if (record?.missing && record.expiresAt && record.expiresAt.getTime() > Date.now()) {
    rememberMiss(path)
    return null
  }

  const known = knownLocation(record)
  if (known) {
    try {
      const bytes = await tryLocation(path, known)
      if (bytes) return { bytes, location: known }
    } catch (error) {
      console.warn(`[resolve] known location failed: ${(error as Error).message}`)
    }
  }

  const found = await search(path, known ?? undefined)

  if (found) {
    const moved =
      !known ||
      known.source !== found.location.source ||
      (known.source === 'github' &&
        found.location.source === 'github' &&
        known.store !== found.location.store)
    if (moved) {
      await saveRecord(path, {
        source: found.location.source,
        store: found.location.source === 'github' ? found.location.store : undefined,
        ref: found.location.source === 'drive' ? found.location.ref : undefined,
        size: found.bytes.length,
        uploadedVia: record?.uploadedVia ?? (found.location.source === 'drive' ? 'drive' : 'github'),
        createdAt: record?.createdAt ?? new Date(),
        resolvedAt: new Date(),
      })
    }
    return found
  }

  if (known) await clearLocation(path)
  await saveMiss(path, MISS_TTL_SECONDS)
  rememberMiss(path)
  return null
}
