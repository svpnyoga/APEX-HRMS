// Delivers queued notification emails. Schedule every few minutes (pg_cron + pg_net, or any scheduler)
// with header x-cron-secret. Uses Resend if RESEND_API_KEY is set; otherwise leaves emails queued
// and reports "not configured" — it never pretends to have sent anything.
import { cors, json, requireCron, serviceClient } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!requireCron(req)) return json({ error: 'Forbidden' }, 403)
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return json({ sent: 0, status: 'not_configured', message: 'Set RESEND_API_KEY to enable email delivery' })
  const db = serviceClient()
  const { data: batch } = await db.from('email_outbox').select('*').eq('status', 'queued').lt('attempts', 5).order('created_at').limit(50)
  let sent = 0, failed = 0
  for (const m of batch ?? []) {
    await db.from('email_outbox').update({ status: 'sending', attempts: m.attempts + 1 }).eq('id', m.id)
    const { data: s } = await db.from('company_settings').select('email_from_name, email_from_address').eq('organisation_id', m.organisation_id).single()
    const from = `${s?.email_from_name ?? 'HR'} <${s?.email_from_address ?? Deno.env.get('DEFAULT_FROM_EMAIL') ?? 'no-reply@example.com'}>`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [m.to_email], subject: m.subject, text: m.body }),
    })
    if (res.ok) { await db.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', m.id); sent++ }
    else { await db.from('email_outbox').update({ status: m.attempts + 1 >= 5 ? 'failed' : 'queued', last_error: (await res.text()).slice(0, 500) }).eq('id', m.id); failed++ }
  }
  return json({ sent, failed })
})
