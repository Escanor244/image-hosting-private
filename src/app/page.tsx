import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { listGallery, type GalleryListing } from '@/lib/gallery'
import { mongoConfigured } from '@/lib/mongodb'
import { writableStores } from '@/lib/stores'
import { Gallery } from '@/components/gallery'

export const metadata = { title: 'Gallery · Image Host' }
export const dynamic = 'force-dynamic'

export default async function GalleryPage() {
  const session = await auth()

  let initial: GalleryListing | null = null
  let initialError: string | null = null
  try {
    initial = await listGallery()
  } catch (error) {
    initialError = (error as Error).message
  }

  const writable = writableStores().map(({ key, label }) => ({ key, label }))
  const defaultStore = writable.some((s) => s.key === env.uploadDefaultStore)
    ? env.uploadDefaultStore
    : (writable[0]?.key ?? '')

  return (
    <Gallery
      initial={initial}
      initialError={initialError}
      user={session?.user?.name ?? 'owner'}
      metadataEnabled={mongoConfigured()}
      publicBaseUrl={env.publicBaseUrl}
      widths={env.imageWidths}
      writableStores={writable}
      defaultStore={defaultStore}
    />
  )
}
