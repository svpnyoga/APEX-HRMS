// Runs background jobs for projects without pg_cron. Call with header x-cron-secret and body {"job": "..."}.
// Jobs: close_attendance_day | leave_accrual | escalate_approvals | announcements | daily_reminders | retention_purge
import { cors, json, requireCron, serviceClient } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (!requireCron(req)) return json({ error: 'Forbidden' }, 403)
  const { job } = await req.json().catch(() => ({ job: '' }))
  const db = serviceClient()
  const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10)
  const yesterday = new Date(Date.parse(ist) - 864e5).toISOString().slice(0, 10)
  const run = async () => {
    switch (job) {
      case 'close_attendance_day': return db.rpc('process_daily_attendance', { p_date: yesterday })
      case 'leave_accrual': {
        const { data: orgs } = await db.from('organisations').select('id').eq('is_active', true)
        const out = []
        for (const o of orgs ?? []) out.push(await db.rpc('run_leave_accrual', { p_org: o.id, p_as_of: ist }))
        return { data: out, error: out.find((r) => r.error)?.error ?? null }
      }
      case 'escalate_approvals': return db.rpc('escalate_overdue_approvals')
      case 'announcements': return db.rpc('notify_due_announcements')
      case 'daily_reminders': return db.rpc('send_daily_reminders')
      case 'retention_purge': return db.rpc('purge_sensitive_data')
      default: return { data: null, error: { message: `Unknown job "${job}"` } }
    }
  }
  const { data, error } = await run() as any
  return error ? json({ job, error: error.message }, 400) : json({ job, result: data })
})
