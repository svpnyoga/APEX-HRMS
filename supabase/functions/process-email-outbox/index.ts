// Delivers queued notification emails (approval requests, decisions, assignments, announcements…).
// Self-contained so it can be pasted into the Supabase dashboard editor.
//
// Sends through SMTP when SMTP_HOST is set (e.g. Gmail: smtp.gmail.com, port 465, app password),
// otherwise through Resend when RESEND_API_KEY is set; otherwise leaves emails queued and says so.
// Note: Supabase Edge Functions cannot open port 587 (or 25) — use 465 (implicit TLS).
//
// Called every few minutes by pg_cron with header x-cron-secret = CRON_SECRET.
// Secrets: CRON_SECRET, SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, optional SMTP_FROM.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import nodemailer from 'npm:nodemailer@6.9.16'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })
const env = (k: string) => Deno.env.get(k) ?? ''
function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!sameSecret(req.headers.get('x-cron-secret') ?? '', env('CRON_SECRET'))) return json({ error: 'Forbidden' }, 403)

  const smtp = env('SMTP_HOST')
  const resendKey = env('RESEND_API_KEY')
  if (!smtp && !resendKey) return json({ sent: 0, status: 'not_configured', message: 'Set SMTP_HOST/SMTP_USER/SMTP_PASS (or RESEND_API_KEY)' })

  const port = Number(env('SMTP_PORT') || 465)
  if (smtp && port === 587) return json({ sent: 0, status: 'misconfigured', message: 'Port 587 is blocked in Supabase Edge Functions — use 465' }, 400)
  const transport = smtp ? nodemailer.createTransport({ host: smtp, port, secure: port === 465, auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') } }) : null

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const { data: batch, error } = await db.from('email_outbox').select('*').eq('status', 'queued').lt('attempts', 5).order('created_at').limit(40)
  if (error) return json({ error: error.message }, 500)

  const fromCache = new Map<string, string>()
  const fromFor = async (org: string) => {
    if (!fromCache.has(org)) {
      const { data: s } = await db.from('company_settings').select('email_from_name, email_from_address').eq('organisation_id', org).maybeSingle()
      // Gmail only sends as the signed-in account, so with SMTP the address defaults to SMTP_USER
      const address = (smtp ? env('SMTP_FROM') || env('SMTP_USER') : s?.email_from_address) || env('DEFAULT_FROM_EMAIL') || 'no-reply@example.com'
      fromCache.set(org, `"${(s?.email_from_name ?? 'HR').replace(/"/g, '')}" <${address}>`)
    }
    return fromCache.get(org)!
  }

  let sent = 0, failed = 0
  for (const m of batch ?? []) {
    // claim the row so two overlapping runs never send the same email twice
    const { data: claimed } = await db.from('email_outbox').update({ status: 'sending', attempts: m.attempts + 1 }).eq('id', m.id).eq('status', 'queued').select('id')
    if (!claimed?.length) continue
    try {
      const from = await fromFor(m.organisation_id)
      if (transport) await transport.sendMail({ from, to: m.to_email, subject: m.subject, text: m.body })
      else {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to_email], subject: m.subject, text: m.body }),
        })
        if (!res.ok) throw new Error((await res.text()).slice(0, 500))
      }
      await db.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', m.id)
      sent++
    } catch (e) {
      await db.from('email_outbox').update({ status: m.attempts + 1 >= 5 ? 'failed' : 'queued', last_error: String((e as Error)?.message ?? e).slice(0, 500) }).eq('id', m.id)
      failed++
    }
  }
  return json({ sent, failed, remaining_in_batch: (batch?.length ?? 0) - sent - failed })
})
