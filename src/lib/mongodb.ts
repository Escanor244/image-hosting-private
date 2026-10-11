/**
 * MongoDB access for the `images` collection — optional by design.
 *
 * Mongo holds two things: path → location mappings (so a lookup goes straight to
 * the right store) and gallery metadata (alt text, tags, dimensions). Neither is
 * needed to serve an image. With MONGODB_URI unset or Atlas unreachable, every
 * function here degrades to "no data" and images resolve straight from GitHub —
 * the same graceful-degradation idea as portfolio-web's tiered reads.
 *
 * Client caching and short timeouts follow portfolio-admin/src/lib/mongodb.ts:
 * one pooled client per instance (Atlas M0 caps connections), and fail fast so a
 * dead database never stalls an image response.
 *
 * This app only ever touches its own collection. The admin's `content` collection
 * is never read or written.
 */

import 'server-only'
import { MongoClient, type Collection } from 'mongodb'
import { env, type SourceName } from './env'

export type ImageRecord = {
  _id: string // image path, e.g. "projects/hero.webp"
  source?: SourceName
  store?: string // GitHub store key, when source is github
  ref?: string // Drive file id, when source is drive
  size?: number
  width?: number
  height?: number
  alt?: string
  tags?: string[]
  uploadedVia?: 'gallery' | 'github' | 'drive'
  createdAt?: Date
  resolvedAt?: Date
  /** Negative-cache row: the path was looked up everywhere and not found. */
  missing?: true
  /** Set only on negative-cache rows; the TTL index removes them. */
  expiresAt?: Date
}

const CLIENT_OPTIONS = {
  serverSelectionTimeoutMS: 3000,
  connectTimeoutMS: 3000,
  socketTimeoutMS: 8000,
  maxPoolSize: 10,
} as const

const globalForMongo = globalThis as unknown as {
  _imgMongoClientPromise?: Promise<MongoClient>
  _imgMongoIndexes?: Promise<unknown>
}

export function mongoConfigured(): boolean {
  return Boolean(env.mongoUri)
}

async function collection(): Promise<Collection<ImageRecord> | null> {
  if (!mongoConfigured()) return null

  try {
    if (!globalForMongo._imgMongoClientPromise) {
      const client = new MongoClient(env.mongoUri, CLIENT_OPTIONS)
      globalForMongo._imgMongoClientPromise = client.connect().catch((error) => {
        // Don't cache a failed connection — the next request should retry.
        globalForMongo._imgMongoClientPromise = undefined
        throw error
      })
    }
    const client = await globalForMongo._imgMongoClientPromise
    const coll = client.db(env.mongoDb).collection<ImageRecord>(env.mongoCollection)

    // TTL index: rows without `expiresAt` (real metadata) are never expired.
    globalForMongo._imgMongoIndexes ??= coll
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((error) => {
        globalForMongo._imgMongoIndexes = undefined
        console.warn('[mongo] could not ensure TTL index:', (error as Error).message)
      })

    return coll
  } catch (error) {
    console.warn('[mongo] unavailable, continuing without it:', (error as Error).message)
    return null
  }
}

/** Runs `fn` against the collection; any failure becomes `fallback`. */
async function safely<T>(
  fallback: T,
  fn: (coll: Collection<ImageRecord>) => Promise<T>
): Promise<T> {
  const coll = await collection()
  if (!coll) return fallback
  try {
    return await fn(coll)
  } catch (error) {
    console.warn('[mongo] operation failed:', (error as Error).message)
    return fallback
  }
}

export function getRecord(path: string): Promise<ImageRecord | null> {
  return safely(null, (coll) => coll.findOne({ _id: path }))
}

export function getRecords(paths: string[]): Promise<Map<string, ImageRecord>> {
  return safely(new Map(), async (coll) => {
    const rows = await coll.find({ _id: { $in: paths }, missing: { $ne: true } }).toArray()
    return new Map(rows.map((row) => [row._id, row]))
  })
}

/** Upsert a positive record, clearing any negative-cache flag. */
export function saveRecord(
  path: string,
  fields: Omit<ImageRecord, '_id' | 'missing' | 'expiresAt'>
): Promise<void> {
  return safely(undefined, async (coll) => {
    await coll.updateOne(
      { _id: path },
      { $set: fields, $unset: { missing: '', expiresAt: '' } },
      { upsert: true }
    )
  })
}

/** Record a miss without clobbering real metadata that might already exist. */
export function saveMiss(path: string, ttlSeconds: number): Promise<void> {
  return safely(undefined, async (coll) => {
    await coll.updateOne(
      { _id: path, source: { $exists: false } },
      {
        $set: {
          missing: true,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
      },
      { upsert: true }
    )
  })
}

export function deleteRecord(path: string): Promise<void> {
  return safely(undefined, async (coll) => {
    await coll.deleteOne({ _id: path })
  })
}

/** Forget only the location, keeping alt text/tags — used by refresh. */
export function clearLocation(path: string): Promise<void> {
  return safely(undefined, async (coll) => {
    await coll.deleteOne({ _id: path, missing: true })
    await coll.updateOne({ _id: path }, { $unset: { source: '', store: '', ref: '' } })
  })
}

export function pingMongo(): Promise<boolean> {
  return safely(false, async (coll) => {
    await coll.db.command({ ping: 1 })
    return true
  })
}
