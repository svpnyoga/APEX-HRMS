# Operations

## Scheduled jobs

Created automatically by migration `0012` when `pg_cron` is available (times UTC; IST = UTC+5:30):

| Job | Schedule | Function |
|---|---|---|
| Close attendance day | 00:15 IST daily | `process_daily_attendance(yesterday)` — absences, missing check‑outs, notifications |
| Leave accrual | 00:30 IST on the 1st | `run_leave_accrual(org, today)` — idempotent |
| Approval escalation & reminders | hourly | `escalate_overdue_approvals()` |
| Scheduled announcements | every 10 min | `notify_due_announcements()` |
| Training due & celebrations | 08:00 IST daily | `send_daily_reminders()` |
| Retention purge | Monday 01:30 IST | `purge_sensitive_data()` — templates of exited staff, old recognition logs, old location points |

Email delivery is an edge function; schedule it with pg_cron + pg_net:
```sql
select cron.schedule('hrms-email', '*/5 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/process-email-outbox',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'))$$);
```
Without pg_cron, call `scheduled-jobs` and `process-email-outbox` from any scheduler (GitHub Actions, cron, Cloud Scheduler) with the `x-cron-secret` header.

## Backups

* Supabase Pro+: daily backups and point‑in‑time recovery (enable PITR for payroll data).
* Logical dump: `supabase db dump --data-only -f backup.sql` (schema is in git).
* *Administration › Data Backup* exports an Excel/JSON copy of what the operator may read (never templates).

## Statutory updates

PF, ESI, gratuity and professional tax are rows in `statutory_configs` / `professional_tax_slabs` with effective dates. When a rate changes, add a new row with the new `effective_from` and set `effective_to` on the old one; past payroll runs are unaffected. Income‑tax (TDS) amounts are entered per employee as recurring deductions after finance review — the system does not compute tax regimes.

## Monitoring

* *Face Recognition › Recognition log*: spikes in `spoof_suspected`, `no_match` or `rate_limited`.
* *Field › Geofencing*: punches outside sites.
* *Email Settings › Outbox*: failed deliveries.
* *Audit Logs*: payroll reopen, manual attendance, role changes, exits.
* Supabase dashboard: API errors, slow queries (indexes exist on all hot paths: attendance by employee/date, approvals by approver/status, ledger by employee/year).
