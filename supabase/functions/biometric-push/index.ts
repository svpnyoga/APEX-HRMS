// Receives punches from fingerprint / RFID / face terminals (or their vendor middleware).
// Auth: header  x-device-key: <device-uuid>.<secret>   (secret issued in Biometric Devices; stored as SHA-256)
// Body:  { "punches": [ { "user_code": "1023", "timestamp": "2026-11-05T09:31:12+05:30", "type": "in" | "out" | "auto", "id": "vendor-log-id" } ] }
import { cors, json, serviceClient, sha256Hex, timingSafeEqual } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const key = req.headers.get('x-device-key') ?? ''
  const [deviceId, secret] = key.split('.')
  if (!deviceId || !secret) return json({ error: 'Missing x-device-key' }, 401)
  const db = serviceClient()
  const { data: device } = await db.from('attendance_devices').select('id, api_key_hash, is_active').eq('id', deviceId).maybeSingle()
  if (!device?.is_active || !device.api_key_hash || !timingSafeEqual(await sha256Hex(secret), device.api_key_hash)) return json({ error: 'Invalid device key' }, 401)

  let body: { punches?: { user_code: string; timestamp: string; type?: string; id?: string }[] }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const punches = (body.punches ?? []).slice(0, 500)
  const results = []
  for (const p of punches) {
    const ts = new Date(p.timestamp)
    if (!p.user_code || isNaN(ts.getTime())) { results.push({ id: p.id, ok: false, error: 'user_code and a valid timestamp are required' }); continue }
    const { data, error } = await db.rpc('ingest_device_punch', {
      p_device: deviceId, p_device_user_code: String(p.user_code), p_occurred_at: ts.toISOString(),
      p_event_type: ['in', 'out'].includes(p.type ?? '') ? p.type : 'auto', p_client_event_id: p.id ?? null,
    })
    results.push(error ? { id: p.id, ok: false, error: error.message } : { id: p.id, ok: true, duplicate: data?.duplicate ?? false, event_type: data?.event_type })
  }
  return json({ accepted: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length, results })
})
