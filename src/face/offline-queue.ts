import { openDB, type IDBPDatabase } from 'idb'
import { supabase } from '@/lib/supabase'

/**
 * Offline attendance queue.
 *  - Each punch gets a client_event_id; the server de-duplicates replays (unique per employee).
 *  - Payloads (which can include a face descriptor) are AES-GCM encrypted with a
 *    non-extractable key kept in IndexedDB, and deleted as soon as they sync.
 *  - Face verification for offline punches happens on the server at sync time.
 *  - The server bounds the client timestamp (offline_max_age_hours) and flags offline punches for HR review.
 */
export type QueuedPunch = {
  client_event_id: string
  kind: 'face' | 'plain'
  occurred_at: string
  args: Record<string, unknown>
}
type Row = { id: string; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer; created_at: string; attempts: number; last_error?: string }

let dbp: Promise<IDBPDatabase> | null = null
const getDb = () => (dbp ??= openDB('hrms-offline', 1, {
  upgrade(db) {
    db.createObjectStore('punches', { keyPath: 'id' })
    db.createObjectStore('keys')
  },
}))

async function key(): Promise<CryptoKey> {
  const db = await getDb()
  let k = (await db.get('keys', 'punch')) as CryptoKey | undefined
  if (!k) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await db.put('keys', k, 'punch')
  }
  return k
}

export async function enqueue(p: QueuedPunch) {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(p)))
  const db = await getDb()
  await db.put('punches', { id: p.client_event_id, iv, data, created_at: new Date().toISOString(), attempts: 0 } satisfies Row)
  window.dispatchEvent(new Event('hrms-queue-changed'))
}

export async function pendingCount() {
  try { return (await (await getDb()).count('punches')) } catch { return 0 }
}

let syncing = false
/** Push queued punches. Returns how many synced. Safe to call repeatedly. */
export async function syncQueue(): Promise<{ synced: number; failed: number; messages: string[] }> {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0, messages: [] }
  syncing = true
  const out = { synced: 0, failed: 0, messages: [] as string[] }
  try {
    const db = await getDb()
    const rows = (await db.getAll('punches')) as Row[]
    const k = await key()
    for (const r of rows) {
      const p = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(r.iv) }, k, r.data))) as QueuedPunch
      const fn = p.kind === 'face' ? 'face_clock' : 'clock_event'
      const { data, error } = await supabase.rpc(fn, { ...p.args, p_client_event_id: p.client_event_id, p_occurred_at: p.occurred_at, p_offline: true })
      const outcome = (data as any)?.outcome
      if (!error && (p.kind === 'plain' || outcome === 'matched')) {
        await db.delete('punches', r.id)
        out.synced++
      } else if (error && /Failed to fetch|NetworkError/i.test(error.message)) {
        break                                            // still offline; keep everything
      } else {
        // permanent failure (e.g. face mismatch, too old): drop it and tell the user
        await db.delete('punches', r.id)
        out.failed++
        out.messages.push(error?.message ?? `Offline punch from ${new Date(p.occurred_at).toLocaleString()} was not accepted (${outcome}).`)
      }
    }
  } finally {
    syncing = false
    window.dispatchEvent(new Event('hrms-queue-changed'))
  }
  return out
}
