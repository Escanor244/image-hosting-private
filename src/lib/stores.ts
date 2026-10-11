/**
 * GitHub image stores, parsed from numbered env groups:
 *
 *   IMG_STORE_1_REPO, IMG_STORE_1_TOKEN, IMG_STORE_1_BRANCH, IMG_STORE_1_DIR,
 *   IMG_STORE_1_MODE, IMG_STORE_1_LABEL, then IMG_STORE_2_*, …
 *
 * Parsing stops at the first missing REPO, so stores are always 1..n with no gaps.
 * Each store carries its own fine-grained token scoped to that one repo — the same
 * least-privilege rule the admin applies to portfolio-data.
 *
 * Tokens never leave this module except through `storeWithToken`, which only the
 * GitHub source calls. Everything the UI or API sees is a `StoreSummary`.
 */

import 'server-only'
import { z } from 'zod'

const MAX_STORES = 20

const storeSchema = z.object({
  key: z.string(),
  repo: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'expected owner/repo'),
  token: z.string().min(1, 'token is required'),
  branch: z.string().min(1).default('main'),
  dir: z
    .string()
    .default('img')
    .transform((d) => d.replace(/^\/+|\/+$/g, ''))
    .refine((d) => !d.split('/').includes('..'), 'dir may not contain ..'),
  // Read-only unless explicitly writable: a forgotten MODE must never let the
  // gallery write somewhere it shouldn't.
  mode: z.enum(['rw', 'ro']).default('ro'),
  label: z.string().optional(),
})

export type Store = z.infer<typeof storeSchema> & { label: string }
export type StoreSummary = Omit<Store, 'token'>

type Parsed = { stores: Store[]; errors: string[] }

let cached: Parsed | null = null

function parse(): Parsed {
  const stores: Store[] = []
  const errors: string[] = []

  for (let n = 1; n <= MAX_STORES; n++) {
    const prefix = `IMG_STORE_${n}_`
    const repo = process.env[`${prefix}REPO`]
    if (!repo) break

    const result = storeSchema.safeParse({
      key: String(n),
      repo,
      token: process.env[`${prefix}TOKEN`] ?? '',
      branch: process.env[`${prefix}BRANCH`] || undefined,
      dir: process.env[`${prefix}DIR`] || undefined,
      mode: process.env[`${prefix}MODE`] || undefined,
      label: process.env[`${prefix}LABEL`] || undefined,
    })

    if (!result.success) {
      // A broken store is skipped, not fatal — the others keep serving.
      errors.push(
        `store ${n}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`
      )
      continue
    }

    stores.push({ ...result.data, label: result.data.label || `Store ${n}` })
  }

  if (errors.length > 0) {
    console.error(`[stores] ignored misconfigured stores — ${errors.join('; ')}`)
  }

  return { stores, errors }
}

function all(): Store[] {
  if (!cached) cached = parse()
  return cached.stores
}

/** Every configured store, in lookup order, without tokens. */
export function listStores(): StoreSummary[] {
  return all().map((store) => {
    const summary: StoreSummary & { token?: string } = { ...store }
    delete summary.token
    return summary
  })
}

export function getStore(key: string): StoreSummary | null {
  return listStores().find((s) => s.key === key) ?? null
}

export function writableStores(): StoreSummary[] {
  return listStores().filter((s) => s.mode === 'rw')
}

/** For the GitHub source only. */
export function storeWithToken(key: string): Store | null {
  return all().find((s) => s.key === key) ?? null
}

export function storeConfigErrors(): string[] {
  if (!cached) cached = parse()
  return cached.errors
}
