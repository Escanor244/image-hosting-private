/**
 * Image path rules — the single definition of what a valid `/i/...` path is.
 *
 * A path is 0–3 folder segments plus a file name, all lowercase:
 *   hero.webp
 *   projects/hero.webp
 *   projects/2026/hero.webp
 *
 * The regexes forbid leading dots, so `..`, `.git` and hidden files are
 * unreachable by construction, and the store's base dir can never be escaped.
 */

export const FOLDER_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,40}$/
export const FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,100}\.(webp|png|jpe?g|gif|avif|svg)$/
export const MAX_FOLDER_DEPTH = 3

export const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/** Validates route segments and returns the normalised path, or null. */
export function parseImagePath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  if (segments.length > MAX_FOLDER_DEPTH + 1) return null

  const decoded: string[] = []
  for (const raw of segments) {
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return null
    }
    decoded.push(segment)
  }

  const file = decoded[decoded.length - 1]
  const folders = decoded.slice(0, -1)

  if (!FILE_NAME.test(file)) return null
  if (!folders.every((f) => FOLDER_SEGMENT.test(f))) return null

  return decoded.join('/')
}

/** Validates a folder string like `projects/2026` (empty = root). */
export function parseFolder(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
  if (trimmed === '') return ''
  const parts = trimmed.split('/')
  if (parts.length > MAX_FOLDER_DEPTH) return null
  return parts.every((p) => FOLDER_SEGMENT.test(p)) ? parts.join('/') : null
}

export function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase()
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? 'application/octet-stream'
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** "My Photo (1).JPG" → "my-photo-1" */
export function slugify(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  const slug = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'image'
}

export function joinPath(folder: string, file: string): string {
  return folder ? `${folder}/${file}` : file
}

export function cacheTag(path: string): string {
  return `img:${path}`
}
