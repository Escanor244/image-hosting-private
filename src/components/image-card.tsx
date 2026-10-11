'use client'

import { useState } from 'react'
import {
  Code,
  Copy,
  FolderInput,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { GalleryItem } from '@/lib/gallery'
import type { Notify, StoreOption } from '@/components/gallery'

type Mode = 'idle' | 'edit' | 'move' | 'delete'

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
  if (!body.ok) throw new Error(body.error ?? 'Request failed')
  return body
}

export function ImageCard({
  item,
  baseUrl,
  widths,
  writableStores,
  metadataEnabled,
  version,
  notify,
  onChanged,
}: {
  item: GalleryItem
  baseUrl: string
  widths: number[]
  writableStores: StoreOption[]
  metadataEnabled: boolean
  version: number
  notify: Notify
  onChanged: () => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>('idle')
  const [busy, setBusy] = useState(false)
  const [width, setWidth] = useState<string>('')
  const [alt, setAlt] = useState(item.alt)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [newPath, setNewPath] = useState(item.path)
  const [toStore, setToStore] = useState(item.store ?? '')
  const [broken, setBroken] = useState(false)

  const apiPath = `/api/images/${encodePath(item.path)}`
  const link = `${baseUrl}/i/${item.path}${width ? `?w=${width}` : ''}`
  const preview = `/preview/${encodePath(item.path)}?w=${widths.includes(320) ? 320 : widths[0]}${item.store ? `&store=${item.store}` : ''}&v=${version}`

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text)
    notify(`${label} copied`)
  }

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await action()
      notify(done)
      setMode('idle')
      await onChanged()
    } catch (error) {
      notify((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const imgTag = `<img src="${link}" alt="${escapeAttr(item.alt)}"${item.width && item.height ? ` width="${item.width}" height="${item.height}"` : ''} loading="lazy" />`

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="relative flex aspect-[4/3] items-center justify-center bg-[repeating-conic-gradient(#f4f4f5_0_25%,#fff_0_50%)] bg-[length:16px_16px] dark:bg-[repeating-conic-gradient(#18181b_0_25%,#27272a_0_50%)]">
        {broken ? (
          <span className="text-xs text-zinc-400">preview unavailable</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={item.alt}
            loading="lazy"
            onError={() => setBroken(true)}
            className="max-h-full max-w-full object-contain"
          />
        )}
        <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {item.storeLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="font-mono text-xs break-all text-zinc-900 dark:text-zinc-100">{item.path}</p>
        <p className="text-xs text-zinc-500">
          {formatBytes(item.size)}
          {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
          {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ''}
        </p>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {t}
              </span>
            ))}
          </div>
        )}
        {item.shadowed && (
          <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Same path exists in an earlier store — that copy is the one served.
          </p>
        )}

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <select
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            aria-label="Width for copied link"
            className="h-7 rounded-md border border-input bg-transparent px-1.5 text-xs dark:bg-input/30"
          >
            <option value="">original</option>
            {widths.map((w) => (
              <option key={w} value={w}>
                {w}w
              </option>
            ))}
          </select>
          <Button size="sm" className="flex-1" onClick={() => void copy(link, 'Link')}>
            <Copy /> Copy link
          </Button>
          <Button size="icon-sm" variant="outline" title="Copy <img> tag" onClick={() => void copy(imgTag, '<img> tag')}>
            <Code />
          </Button>
        </div>

        <div className="flex gap-1">
          {metadataEnabled && (
            <Button size="xs" variant="ghost" onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}>
              <Pencil /> Details
            </Button>
          )}
          {item.writable && (
            <Button size="xs" variant="ghost" onClick={() => setMode(mode === 'move' ? 'idle' : 'move')}>
              <FolderInput /> Move
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            title="Drop cached copy (after replacing the file on GitHub)"
            onClick={() =>
              void run(
                () => call('/api/refresh', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: item.path }),
                }),
                'Cache cleared'
              )
            }
          >
            <RefreshCw />
          </Button>
          {item.writable && (
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto text-red-600"
              onClick={() => setMode(mode === 'delete' ? 'idle' : 'delete')}
            >
              <Trash2 />
            </Button>
          )}
        </div>

        {mode === 'edit' && (
          <form
            className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
            onSubmit={(e) => {
              e.preventDefault()
              void run(
                () => call(apiPath, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    alt,
                    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
                  }),
                }),
                'Saved'
              )
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">Alt text</Label>
              <Input value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tags (comma separated)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Save
            </Button>
          </form>
        )}

        {mode === 'move' && item.store && (
          <form
            className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
            onSubmit={(e) => {
              e.preventDefault()
              void run(
                () => call(apiPath, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    newPath: newPath.trim().toLowerCase(),
                    fromStore: item.store,
                    toStore,
                  }),
                }),
                'Moved'
              )
            }}
          >
            <div className="space-y-1">
              <Label className="text-xs">Path</Label>
              <Input value={newPath} onChange={(e) => setNewPath(e.target.value)} className="font-mono text-xs" />
            </div>
            {writableStores.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Store</Label>
                <select
                  value={toStore}
                  onChange={(e) => setToStore(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
                >
                  {writableStores.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-xs text-zinc-500">
              Changing the path changes the link. Changing only the store keeps it.
            </p>
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Move
            </Button>
          </form>
        )}

        {mode === 'delete' && item.store && (
          <div className="space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Delete from {item.storeLabel}? Anywhere this image is embedded will break.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => call(`${apiPath}?store=${encodeURIComponent(item.store!)}`, { method: 'DELETE' }),
                    'Deleted'
                  )
                }
              >
                {busy && <Loader2 className="animate-spin" />} Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
