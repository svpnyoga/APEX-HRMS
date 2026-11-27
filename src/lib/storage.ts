import { supabase } from './supabase'

export type Bucket = 'employee-documents' | 'claim-receipts' | 'avatars' | 'learning-content' | 'announcement-files'

const safe = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-80)

/** what the bytes really are (Android sometimes gives files with no extension and no type) */
function sniffType(b: Uint8Array, name: string, given: string) {
  if (given) return given
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  return 'application/octet-stream'
}
const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

/** big phone photos are shrunk to max 2000 px JPEG before upload: faster and far more reliable on mobile data */
async function shrinkImage(blob: Blob, type: string): Promise<{ blob: Blob; type: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(type) || blob.size < 1.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return { blob, type }
  try {
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.()
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85))
    return out && out.size < blob.size ? { blob: out, type: 'image/jpeg' } : { blob, type }
  } catch { return { blob, type } }
}

export type UploadResult = { path: string; type: string; size: number; name: string }

/**
 * Upload to <org>/<owner>/<uuid>-<file>, matching the storage RLS policies.
 * The file is read into memory first: on Android a file picked from Google Drive / WhatsApp / Downloads can
 * fail while being sent, which the browser reports only as "Failed to fetch". Reading first gives a clear
 * message, and a dropped connection is retried once.
 */
export async function uploadFileDetailed(bucket: Bucket, orgId: string, ownerId: string, file: File): Promise<UploadResult> {
  let bytes: ArrayBuffer
  try { bytes = await file.arrayBuffer() } catch {
    throw new Error('Could not read this file on the phone. If it is in Google Drive, WhatsApp or another app, save/download it to the phone first, then choose it again.')
  }
  let type = sniffType(new Uint8Array(bytes.slice(0, 8)), file.name, file.type)
  let name = file.name
  if (!/\.[a-z0-9]{2,5}$/i.test(name) && EXT[type]) name += EXT[type]
  const shrunk = await shrinkImage(new Blob([bytes], { type }), type)
  if (shrunk.type !== type) { type = shrunk.type; name = name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg' }
  const path = `${orgId}/${ownerId}/${crypto.randomUUID()}-${safe(name)}`
  for (let attempt = 1; ; attempt++) {
    try {
      const { error } = await supabase.storage.from(bucket).upload(path, shrunk.blob, { contentType: type, upsert: false })
      if (error) throw error
      return { path, type, size: shrunk.blob.size, name }
    } catch (e) {
      const net = /Failed to fetch|NetworkError|network|load failed/i.test(String((e as Error)?.message))
      if (net && attempt < 2) { await new Promise((r) => setTimeout(r, 1500)); continue }
      if (net) throw new Error(`The upload was interrupted (${(shrunk.blob.size / 1048576).toFixed(1)} MB). Check the internet connection — Wi-Fi works best — and try again.`)
      throw e
    }
  }
}

export async function uploadFile(bucket: Bucket, orgId: string, ownerId: string, file: File) {
  return (await uploadFileDetailed(bucket, orgId, ownerId, file)).path
}

export async function signedUrl(bucket: Bucket, path: string, seconds = 300) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

export async function openFile(bucket: Bucket, path: string) {
  const url = await signedUrl(bucket, path)
  window.open(url, '_blank', 'noopener')
}
