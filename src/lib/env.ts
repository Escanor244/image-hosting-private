/**
 * Server-only environment access.
 *
 * Every value here is a secret or a server concern. None of it is prefixed
 * NEXT_PUBLIC_ — that would inline it into the browser bundle, which is how the
 * legacy portfolio build published a GitHub token to every visitor.
 *
 * Store configuration (IMG_STORE_n_*) is parsed separately in `stores.ts`.
 */

import 'server-only'

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
}

function list(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Exact origins only — `https://host[:port]`, no path. Anything unparsable is
 * dropped rather than thrown on, so one typo can't take every image offline;
 * `npm run check-env` reports it instead.
 */
function parseOrigins(values: string[]): Set<string> {
  const origins = new Set<string>()
  for (const value of values) {
    try {
      origins.add(new URL(value).origin.toLowerCase())
    } catch {
      // reported by check-env
    }
  }
  return origins
}

/**
 * `https://escanor244-*.vercel.app` → one wildcard per `*`, matching a single DNS
 * label fragment. A `*` can never span a dot, so `https://*.vercel.app` cannot be
 * satisfied by `https://evil.com.vercel.app`-style tricks beyond one label.
 */
function parsePatterns(values: string[]): RegExp[] {
  return values.map((pattern) => {
    const escaped = pattern
      .toLowerCase()
      .replace(/\/+$/, '')
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[a-z0-9-]+')
    return new RegExp(`^${escaped}$`)
  })
}

function parseWidths(): number[] {
  const widths = list('IMAGE_WIDTHS')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 16 && n <= 4096)
  return widths.length > 0 ? widths : [320, 640, 960, 1280, 1920]
}

export type SourceName = 'github' | 'drive'

export const env = {
  // ── Embedding allowlist ────────────────────────────────────────────────────
  get allowedOrigins() {
    return parseOrigins(list('ALLOWED_ORIGINS'))
  },
  get allowedOriginPatterns() {
    return parsePatterns(list('ALLOWED_ORIGIN_PATTERNS'))
  },
  get allowLocalhost() {
    return process.env.ALLOW_LOCALHOST === 'true'
  },

  // ── Sources ────────────────────────────────────────────────────────────────
  get imageSources(): SourceName[] {
    const sources = list('IMAGE_SOURCES').filter(
      (s): s is SourceName => s === 'github' || s === 'drive'
    )
    return sources.length > 0 ? sources : ['github']
  },
  get uploadDefaultStore() {
    return optional('IMG_UPLOAD_DEFAULT_STORE', '1')
  },

  // Drive is optional: with no folder ids it is never consulted.
  get driveFolderIds() {
    return list('DRIVE_FOLDER_IDS')
  },
  get googleServiceAccountEmail() {
    return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  },
  get googlePrivateKey() {
    const encoded = process.env.GOOGLE_PRIVATE_KEY_B64 || ''
    return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''
  },

  // ── MongoDB (optional cache + metadata) ────────────────────────────────────
  get mongoUri() {
    return process.env.MONGODB_URI || ''
  },
  get mongoDb() {
    return optional('MONGODB_DB', 'portfolio')
  },
  get mongoCollection() {
    return optional('MONGODB_COLLECTION', 'images')
  },

  // ── Links ──────────────────────────────────────────────────────────────────
  get publicBaseUrl() {
    return optional('PUBLIC_BASE_URL', '').replace(/\/+$/, '')
  },

  // ── Tuning / ops ───────────────────────────────────────────────────────────
  get cacheSeconds() {
    const n = Number(process.env.CACHE_SECONDS)
    return Number.isFinite(n) && n >= 0 ? n : 3600
  },
  get imageWidths() {
    return parseWidths()
  },
  get refreshSecret() {
    return process.env.REFRESH_SECRET || ''
  },
}

export function driveEnabled(): boolean {
  return (
    env.imageSources.includes('drive') &&
    env.driveFolderIds.length > 0 &&
    Boolean(env.googleServiceAccountEmail && env.googlePrivateKey)
  )
}
