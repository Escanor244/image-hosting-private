'use client'

import { useRef, useState } from 'react'
import { Check, Copy, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { compressForUpload } from '@/lib/compress'
import { cn } from '@/lib/utils'
import type { Notify, StoreOption } from '@/components/gallery'

type QueueItem = {
  id: number
  name: string
  state: 'compressing' | 'uploading' | 'done' | 'error'
  message?: string
  path?: string
}

const FOLDER_RULE = /^([a-z0-9][a-z0-9_-]{0,40})(\/[a-z0-9][a-z0-9_-]{0,40}){0,2}$/

export function UploadPanel({
  stores,
  defaultStore,
  folders,
  metadataEnabled,
  baseUrl,
  notify,
  onUploaded,
}: {
  stores: StoreOption[]
  defaultStore: string
  folders: string[]
  metadataEnabled: boolean
  baseUrl: string
  notify: Notify
  onUploaded: () => Promise<void>
}) {
  const [store, setStore] = useState(defaultStore)
  const [folder, setFolder] = useState('')
  const [alt, setAlt] = useState('')
  const [tags, setTags] = useState('')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)

  const folderValue = folder.trim().replace(/^\/+|\/+$/g, '').toLowerCase()
  const folderValid = folderValue === '' || FOLDER_RULE.test(folderValue)
  const busy = queue.some((q) => q.state === 'compressing' || q.state === 'uploading')

  if (stores.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        No writable store is configured, so uploads are off. Set{' '}
        <code className="font-mono text-xs">IMG_STORE_1_MODE=&quot;rw&quot;</code> to enable them.
      </p>
    )
  }

  function update(id: number, patch: Partial<QueueItem>) {
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function uploadOne(file: File, id: number) {
    try {
      const ready = await compressForUpload(file)
      update(id, { state: 'uploading' })

      const form = new FormData()
      form.set('file', ready, file.name)
      form.set('store', store)
      form.set('folder', folderValue)
      form.set('alt', alt)
      form.set('tags', tags)

      const response = await fetch('/api/images', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!body.ok) throw new Error(body.error ?? 'Upload failed')

      update(id, { state: 'done', path: body.item.path })
    } catch (error) {
      update(id, { state: 'error', message: (error as Error).message })
    }
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    if (!folderValid) {
      notify('Fix the folder name first', 'error')
      return
    }

    const files = Array.from(list).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) {
      notify('Those are not images', 'error')
      return
    }

    const items = files.map((file) => ({
      id: nextId.current++,
      name: file.name,
      state: 'compressing' as const,
    }))
    setQueue((q) => [...items, ...q].slice(0, 30))

    // One at a time: each upload is a commit, and parallel commits to the same
    // branch race each other and fail.
    for (let i = 0; i < files.length; i++) {
      await uploadOne(files[i], items[i].id)
    }

    if (inputRef.current) inputRef.current.value = ''
    await onUploaded()
  }

  async function copy(path: string) {
    await navigator.clipboard.writeText(`${baseUrl}/i/${path}`)
    notify('Link copied')
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="up-store">Store</Label>
          <select
            id="up-store"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
          >
            {stores.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="up-folder">Folder</Label>
          <Input
            id="up-folder"
            list="up-folders"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="projects (blank = root)"
            aria-invalid={!folderValid}
            className="font-mono"
          />
          <datalist id="up-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        {metadataEnabled ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="up-alt">Alt text</Label>
              <Input id="up-alt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describes the image" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="up-tags">Tags</Label>
              <Input id="up-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hero, project" />
            </div>
          </>
        ) : (
          <p className="self-end text-xs text-zinc-500 sm:col-span-2 lg:col-span-2">
            Alt text and tags need MongoDB — set <code className="font-mono">MONGODB_URI</code> to enable them.
          </p>
        )}
      </div>

      {!folderValid && (
        <p className="mt-2 text-xs text-red-600">
          Folder: lowercase letters, digits, - and _, up to 3 levels (e.g. projects/2026).
        </p>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void handleFiles(e.dataTransfer.files)
        }}
        disabled={busy}
        className={cn(
          'mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors',
          dragging
            ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800'
            : 'border-zinc-300 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700'
        )}
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        <span>{busy ? 'Uploading…' : 'Drop images here or click to choose'}</span>
        <span className="text-xs text-zinc-400">Converted to WebP · EXIF/GPS stripped · max 4 MB after compression</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {queue.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {queue.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              {item.state === 'done' ? (
                <Check className="size-4 text-emerald-600" />
              ) : item.state === 'error' ? (
                <X className="size-4 text-red-600" />
              ) : (
                <Loader2 className="size-4 animate-spin text-zinc-400" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {item.path ?? item.name}
                {item.state === 'compressing' && ' — compressing'}
                {item.state === 'uploading' && ' — committing to GitHub'}
                {item.message && <span className="text-red-600"> — {item.message}</span>}
              </span>
              {item.path && (
                <Button variant="ghost" size="xs" onClick={() => void copy(item.path!)}>
                  <Copy /> Copy link
                </Button>
              )}
            </li>
          ))}
          {!busy && (
            <li>
              <button
                type="button"
                className="text-xs text-zinc-500 underline-offset-4 hover:underline"
                onClick={() => setQueue([])}
              >
                Clear list
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
