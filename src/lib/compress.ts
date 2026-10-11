/**
 * Browser-side shrink before upload.
 *
 * Vercel rejects request bodies over 4.5 MB, so a phone photo (often 5–12 MB)
 * would never reach the server. This re-encodes to WebP on a canvas, stepping
 * quality and size down until it fits. The server re-encodes again with sharp
 * either way; this step only exists to get the bytes through the door.
 *
 * GIFs are left alone when they already fit — a canvas would flatten the
 * animation to its first frame.
 */

const TARGET_BYTES = 4 * 1024 * 1024
const MAX_DIMENSION = 3840

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

export async function compressForUpload(file: File): Promise<File> {
  if (file.size <= TARGET_BYTES && (file.type === 'image/gif' || file.type === 'image/webp')) {
    return file
  }
  if (file.type === 'image/svg+xml') {
    throw new Error('SVG uploads are not supported — add SVGs directly to the repo')
  }

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    // The browser can't decode it (e.g. HEIC outside Safari). Send as-is if it
    // fits and let the server decide.
    if (file.size <= TARGET_BYTES) return file
    throw new Error('This browser cannot read this image, and it is over 4 MB')
  }

  let scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const name = file.name.replace(/\.[^.]+$/, '') + '.webp'

  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await toBlob(canvas, attempt < 3 ? 0.9 - attempt * 0.1 : 0.7)
    if (blob && blob.size <= TARGET_BYTES) {
      bitmap.close()
      return new File([blob], name, { type: 'image/webp' })
    }
    if (attempt >= 2) scale *= 0.8
  }

  bitmap.close()
  throw new Error('Could not compress this image under 4 MB')
}
