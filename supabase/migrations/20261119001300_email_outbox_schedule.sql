-- Send queued notification emails every 5 minutes by calling the process-email-outbox Edge Function.
-- The shared secret lives in Supabase Vault (never in this file). Before running this, create it once:
--     select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'hrms_cron_secret');
-- Also re-runs the existing HRMS jobs so pg_cron is enabled everywhere.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- the function URL is stored in Vault too, so this file has no project-specific values
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'hrms_functions_url') then
    perform vault.create_secret('https://fatoruslncucjyoaxkrj.supabase.co/functions/v1', 'hrms_functions_url');
  end if;
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'hrms-email-outbox';
select cron.schedule('hrms-email-outbox', '*/5 * * * *', $j$
  -- rows left in 'sending' by an interrupted run go back to the queue
  update public.email_outbox set status = 'queued' where status = 'sending' and created_at < now() - interval '15 minutes';
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'hrms_functions_url') || '/process-email-outbox',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hrms_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000);
$j$);

-- show every scheduled HRMS job so you can confirm they exist and are active
select jobname, schedule, active from cron.job where jobname like 'hrms-%' order by jobname;
