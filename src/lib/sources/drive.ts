/**
 * Google Drive source — optional, read-only, inert until configured.
 *
 * One service account reads from any number of Google accounts: each account
 * shares a folder with the service account's email (Viewer), and that folder's id
 * goes in DRIVE_FOLDER_IDS. Files stay private in Drive, so a Drive link alone
 * opens nothing; the only way to the bytes is through the guarded route.
 *
 * Paths map onto subfolders: `projects/hero.webp` = file `hero.webp` inside a
 * `projects` folder inside one of the shared root folders.
 *
 * `google-auth-library` is imported lazily so GitHub-only deployments never load it.
 */

import 'server-only'
import { env, driveEnabled } from '../env'
import { cacheTag, FILE_NAME, FOLDER_SEGMENT } from '../paths'

const API = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

type DriveFile = {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
}

let tokenCache: { value: string; expiresAt: number } | null = null

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.value

  const { JWT } = await import('google-auth-library')
  const client = new JWT({
    email: env.googleServiceAccountEmail,
    key: env.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  })
  const { token, res } = await client.getAccessToken()
  if (!token) throw new Error('Drive: no access token')

  const expiry = (res?.data as { expiry_date?: number } | undefined)?.expiry_date
  tokenCache = { value: token, expiresAt: expiry ?? Date.now() + 50 * 60_000 }
  return token
}

/** Drive query strings quote with single quotes; escape them and backslashes. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function listChildren(parentId: string, extra = ''): Promise<DriveFile[]> {
  const token = await accessToken()
  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      q: `${quote(parentId)} in parents and trashed = false${extra}`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const response = await fetch(`${API}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Drive ${response.status} listing`)

    const body = (await response.json()) as { files: DriveFile[]; nextPageToken?: string }
    files.push(...body.files)
    pageToken = body.nextPageToken
  } while (pageToken)

  return files
}

/** Walk folder names from a root to the file. Returns the Drive file id or null. */
async function findInRoot(rootId: string, path: string): Promise<string | null> {
  const parts = path.split('/')
  const fileName = parts.pop()!
  let parent = rootId

  for (const folder of parts) {
    const matches = await listChildren(
      parent,
      ` and name = ${quote(folder)} and mimeType = ${quote(FOLDER_MIME)}`
    )
    if (matches.length === 0) return null
    parent = matches[0].id
  }

  const files = await listChildren(
    parent,
    ` and name = ${quote(fileName)} and mimeType != ${quote(FOLDER_MIME)}`
  )
  return files[0]?.id ?? null
}

/** Resolve a path across all shared roots, in DRIVE_FOLDER_IDS order. */
export async function findFile(path: string): Promise<string | null> {
  if (!driveEnabled()) return null
  for (const rootId of env.driveFolderIds) {
    const id = await findInRoot(rootId, path)
    if (id) return id
  }
  return null
}

export async function fetchFile(
  fileId: string,
  path: string
): Promise<{ bytes: Buffer } | null> {
  const token = await accessToken()
  const response = await fetch(
    `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: env.cacheSeconds, tags: [cacheTag(path)] },
    }
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Drive ${response.status} reading file`)
  return { bytes: Buffer.from(await response.arrayBuffer()) }
}

export type DriveEntry = { path: string; size: number; fileId: string; modifiedTime?: string }

/** Every servable image under every shared root, max depth 3, for the gallery. */
export async function listDriveImages(): Promise<DriveEntry[]> {
  if (!driveEnabled()) return []
  const seen = new Set<string>()
  const entries: DriveEntry[] = []

  async function walk(folderId: string, prefix: string, depth: number) {
    for (const item of await listChildren(folderId)) {
      if (item.mimeType === FOLDER_MIME) {
        if (depth < 3 && FOLDER_SEGMENT.test(item.name)) {
          await walk(item.id, prefix ? `${prefix}/${item.name}` : item.name, depth + 1)
        }
        continue
      }
      if (!FILE_NAME.test(item.name)) continue
      const path = prefix ? `${prefix}/${item.name}` : item.name
      if (seen.has(path)) continue // earlier root wins, same as serving
      seen.add(path)
      entries.push({
        path,
        size: Number(item.size ?? 0),
        fileId: item.id,
        modifiedTime: item.modifiedTime,
      })
    }
  }

  for (const rootId of env.driveFolderIds) {
    await walk(rootId, '', 0)
  }
  return entries
}
