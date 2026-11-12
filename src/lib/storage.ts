import { supabase } from './supabase'

export type Bucket = 'employee-documents' | 'claim-receipts' | 'avatars' | 'learning-content' | 'announcement-files'

const safe = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-80)

/** Upload to <org>/<owner>/<uuid>-<file>, matching the storage RLS policies. */
export async function uploadFile(bucket: Bucket, orgId: string, ownerId: string, file: File) {
  const path = `${orgId}/${ownerId}/${crypto.randomUUID()}-${safe(file.name)}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
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
