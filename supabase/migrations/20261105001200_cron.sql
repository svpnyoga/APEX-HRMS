-- =====================================================================
-- 0012 SCHEDULED JOBS (pg_cron). Skipped automatically where pg_cron is unavailable.
-- Times are UTC. 18:45 UTC = 00:15 IST.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('hrms-close-attendance-day', '45 18 * * *', $j$select public.process_daily_attendance((now() at time zone 'Asia/Kolkata')::date - 1)$j$);
    perform cron.schedule('hrms-leave-accrual', '0 19 1 * *', $j$select public.run_leave_accrual(id, (now() at time zone 'Asia/Kolkata')::date) from public.organisations where is_active$j$);
    perform cron.schedule('hrms-approval-escalation', '0 * * * *', $j$select public.escalate_overdue_approvals()$j$);
    perform cron.schedule('hrms-announcements', '*/10 * * * *', $j$select public.notify_due_announcements()$j$);
    perform cron.schedule('hrms-daily-reminders', '30 2 * * *', $j$select public.send_daily_reminders()$j$);
    perform cron.schedule('hrms-retention-purge', '0 20 * * 0', $j$select public.purge_sensitive_data()$j$);
  else
    raise notice 'pg_cron not available: schedule the jobs listed in docs/OPERATIONS.md externally';
  end if;
end $$;
