/**
 * GitHub Contents / Trees API client for image stores.
 *
 * Reads use the Contents API with the raw media type, which returns the bytes
 * directly and works up to 100 MB (the JSON form caps at 1 MB). The public
 * `raw.githubusercontent.com` host is never used — it needs no token for public
 * repos, and the stores are private precisely so that path doesn't exist.
 *
 * Image reads go through Next's data cache, tagged per path, so GitHub sees about
 * one request per image per CACHE_SECONDS no matter how much traffic arrives.
 * That is what makes the 5,000 req/hour token limit a non-issue.
 *
 * Headers pattern from portfolio-admin/src/lib/github.ts.
 */

import 'server-only'
import { env } from '../env'
import { cacheTag, FILE_NAME, FOLDER_SEGMENT } from '../paths'
import { storeWithToken, type Store } from '../stores'

// Overridable only for local testing against a mock; never set in production.
const API_BASE = (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '')

function headers(store: Store, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Authorization: `Bearer ${store.token}`,
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'portfolio-img-hosting',
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function repoPath(store: Store, path: string): string {
  return store.dir ? `${store.dir}/${path}` : path
}

function contentsUrl(store: Store, path: string): string {
  return `${API_BASE}/repos/${store.repo}/contents/${encodePath(repoPath(store, path))}`
}

function requireStore(key: string): Store {
  const store = storeWithToken(key)
  if (!store) throw new Error(`Unknown store "${key}"`)
  return store
}

export type RawImage = { bytes: Buffer; sha: string | null }

/**
 * Fetch one image's bytes. Returns null for a genuine 404; throws on anything
 * else so the caller can distinguish "not here" from "GitHub is unhappy".
 *
 * `fresh` bypasses the data cache — used by the gallery when moving a file, where
 * a stale copy would be committed to the new location.
 */
export async function fetchImage(
  storeKey: string,
  path: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<RawImage | null> {
  const store = requireStore(storeKey)
  const url = `${contentsUrl(store, path)}?ref=${encodeURIComponent(store.branch)}`

  const response = await fetch(url, {
    headers: headers(store, 'application/vnd.github.raw'),
    ...(fresh
      ? { cache: 'no-store' as const }
      : { next: { revalidate: env.cacheSeconds, tags: [cacheTag(path)] } }),
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} reading ${store.repo}:${path}`)
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    // The raw response's ETag is the blob SHA in quotes.
    sha: response.headers.get('etag')?.replace(/^W\/|"/g, '') ?? null,
  }
}

/** Blob SHA of a file, needed to update or delete it. Null when absent. */
export async function fileSha(storeKey: string, path: string): Promise<string | null> {
  const store = requireStore(storeKey)
  const response = await fetch(
    `${contentsUrl(store, path)}?ref=${encodeURIComponent(store.branch)}`,
    { headers: headers(store), cache: 'no-store' }
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} checking ${store.repo}:${path}`)
  }
  const body = (await response.json()) as { sha?: string; type?: string }
  return body.type === 'file' && body.sha ? body.sha : null
}

export type TreeEntry = { path: string; size: number; sha: string }

/**
 * Every image under the store's base dir, in one request (git trees API,
 * recursive). Entries whose path wouldn't be servable — bad names, too deep,
 * unsupported type — are left out so the gallery never shows a dead link.
 */
export async function listImages(storeKey: string): Promise<TreeEntry[]> {
  const store = requireStore(storeKey)
  const response = await fetch(
    `${API_BASE}/repos/${store.repo}/git/trees/${encodeURIComponent(store.branch)}?recursive=1`,
    { headers: headers(store), cache: 'no-store' }
  )

  // An empty repo has no tree yet.
  if (response.status === 404 || response.status === 409) return []
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} listing ${store.repo}`)
  }

  const body = (await response.json()) as {
    tree: { path: string; type: string; size?: number; sha: string }[]
    truncated?: boolean
  }

  if (body.truncated) {
    console.warn(`[github] tree listing for ${store.repo} was truncated`)
  }

  const prefix = store.dir ? `${store.dir}/` : ''
  const entries: TreeEntry[] = []

  for (const item of body.tree) {
    if (item.type !== 'blob' || !item.path.startsWith(prefix)) continue
    const path = item.path.slice(prefix.length)
    const parts = path.split('/')
    const file = parts.pop() ?? ''
    if (parts.length > 3 || !FILE_NAME.test(file)) continue
    if (!parts.every((p) => FOLDER_SEGMENT.test(p))) continue
    entries.push({ path, size: item.size ?? 0, sha: item.sha })
  }

  return entries
}

/** Create or replace a file. Pass `sha` when replacing. */
export async function putImage(
  storeKey: string,
  path: string,
  bytes: Buffer,
  message: string,
  sha?: string | null
): Promise<void> {
  const store = requireStore(storeKey)
  const response = await fetch(contentsUrl(store, path), {
    method: 'PUT',
    headers: { ...headers(store), 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      message,
      content: bytes.toString('base64'),
      branch: store.branch,
      ...(sha ? { sha } : {}),
    }),
  })

  if (!response.ok) {
    throw new GitHubWriteError(response.status, `writing ${store.repo}:${path}`)
  }
}

export async function deleteImage(
  storeKey: string,
  path: string,
  message: string
): Promise<void> {
  const store = requireStore(storeKey)

  // Read SHA → delete → on a SHA race (409/422) re-read once and retry. A blind
  // write with a stale SHA is exactly the lost-update bug the admin hit (docs/02 N3).
  for (let attempt = 0; attempt < 2; attempt++) {
    const sha = await fileSha(storeKey, path)
    if (!sha) return // already gone

    const response = await fetch(contentsUrl(store, path), {
      method: 'DELETE',
      headers: { ...headers(store), 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ message, sha, branch: store.branch }),
    })

    if (response.ok) return
    if ((response.status === 409 || response.status === 422) && attempt === 0) continue
    throw new GitHubWriteError(response.status, `deleting ${store.repo}:${path}`)
  }
}

/** Reachability check for check-env and the stores API. Never returns the token. */
export async function pingStore(storeKey: string): Promise<boolean> {
  const store = requireStore(storeKey)
  try {
    const response = await fetch(`${API_BASE}/repos/${store.repo}`, {
      headers: headers(store),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

export class GitHubWriteError extends Error {
  constructor(
    readonly status: number,
    action: string
  ) {
    super(`GitHub ${status} ${action}`)
  }
}
