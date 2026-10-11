'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { signOut } from 'next-auth/react'
import { ImageIcon, Loader2, LogOut, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImageCard } from '@/components/image-card'
import { UploadPanel } from '@/components/upload-panel'
import { cn } from '@/lib/utils'
import type { GalleryItem, GalleryListing } from '@/lib/gallery'

export type StoreOption = { key: string; label: string }

export type Notify = (message: string, tone?: 'ok' | 'error') => void

const ROOT = '__root__'
const ALL = '__all__'

export function Gallery({
  initial,
  initialError,
  user,
  metadataEnabled,
  publicBaseUrl,
  widths,
  writableStores,
  defaultStore,
}: {
  initial: GalleryListing | null
  initialError: string | null
  user: string
  metadataEnabled: boolean
  publicBaseUrl: string
  widths: number[]
  writableStores: StoreOption[]
  defaultStore: string
}) {
  const [listing, setListing] = useState<GalleryListing | null>(initial)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(initialError)
  const [folder, setFolder] = useState(ALL)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  // Bumped after edits so previews of replaced bytes don't come from browser cache.
  const [version, setVersion] = useState(0)

  const notify: Notify = useCallback((message, tone = 'ok') => {
    setToast({ message, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch('/api/images', { cache: 'no-store' })
      const body = await response.json()
      if (!body.ok) throw new Error(body.error ?? 'Failed to load')
      setListing(body)
    } catch (error) {
      setLoadError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const afterChange = useCallback(async () => {
    setVersion((v) => v + 1)
    await load()
  }, [load])

  const baseUrl =
    publicBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  const visible = useMemo(() => {
    const items = listing?.items ?? []
    const q = query.trim().toLowerCase()
    return items.filter((item: GalleryItem) => {
      if (folder === ROOT && item.folder !== '') return false
      if (folder !== ALL && folder !== ROOT && item.folder !== folder) return false
      if (!q) return true
      return (
        item.path.includes(q) ||
        item.alt.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q))
      )
    })
  }, [listing, folder, query])

  const folders = listing?.folders ?? []
  const brokenStores = listing?.stores.filter((s) => !s.ok) ?? []

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-zinc-900 dark:bg-zinc-100">
            <ImageIcon className="size-4 text-white dark:text-zinc-900" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Image Host</h1>
            <p className="truncate text-xs text-zinc-500">
              {listing
                ? `${listing.items.length} images · ${listing.stores.length} store${listing.stores.length === 1 ? '' : 's'}${listing.drive.enabled ? ' + Drive' : ''}`
                : 'Loading…'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            <span className="hidden sm:inline">Reload</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void signOut({ callbackUrl: '/login' })}
            title={`Signed in as ${user}`}
          >
            <LogOut />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {(loadError || brokenStores.length > 0 || (listing?.drive.enabled && !listing.drive.ok)) && (
          <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            {loadError && <Problem text={`Could not load gallery: ${loadError}`} />}
            {brokenStores.map((s) => (
              <Problem key={s.key} text={`${s.label} (${s.repo}): ${s.error}`} />
            ))}
            {listing?.drive.enabled && !listing.drive.ok && (
              <Problem text={`Drive: ${listing.drive.error}`} />
            )}
          </div>
        )}

        <UploadPanel
          stores={writableStores}
          defaultStore={defaultStore}
          folders={folders}
          metadataEnabled={metadataEnabled}
          baseUrl={baseUrl}
          notify={notify}
          onUploaded={afterChange}
        />

        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-wrap gap-1.5">
              <FolderTab active={folder === ALL} onClick={() => setFolder(ALL)}>
                All
              </FolderTab>
              <FolderTab active={folder === ROOT} onClick={() => setFolder(ROOT)}>
                (root)
              </FolderTab>
              {folders.map((f) => (
                <FolderTab key={f} active={folder === f} onClick={() => setFolder(f)}>
                  {f}/
                </FolderTab>
              ))}
            </div>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, alt, tag"
                className="pl-8"
              />
            </div>
          </div>

          {loading && !listing ? (
            <div className="flex justify-center py-16 text-zinc-400">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-zinc-500">
              {listing?.items.length ? 'Nothing matches.' : 'No images yet — upload one above.'}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((item) => (
                <ImageCard
                  key={`${item.source}:${item.store ?? 'drive'}:${item.path}`}
                  item={item}
                  baseUrl={baseUrl}
                  widths={widths}
                  writableStores={writableStores}
                  metadataEnabled={metadataEnabled}
                  version={version}
                  notify={notify}
                  onChanged={afterChange}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'fixed right-4 bottom-4 left-4 z-20 mx-auto max-w-md rounded-lg px-4 py-2.5 text-sm shadow-lg sm:left-auto',
            toast.tone === 'ok'
              ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-red-600 text-white'
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

function Problem({ text }: { text: string }) {
  return (
    <p className="flex gap-2">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span className="break-all">{text}</span>
    </p>
  )
}

function FolderTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 font-mono text-xs transition-colors',
        active
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'
      )}
    >
      {children}
    </button>
  )
}
