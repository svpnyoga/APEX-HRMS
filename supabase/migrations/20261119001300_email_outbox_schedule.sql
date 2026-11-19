-- Send queued notification emails every 5 minutes by calling the process-email-outbox Edge Function.
-- The shared secret lives in Supabase Vault (never in this file). Before running this, create it once:
--     select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'hrms_cron_secret');
-- Skipped automatically where pg_cron / pg_net / Vault are unavailable (e.g. local tests).

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'pg_cron / pg_net / vault not available — email schedule not created';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  -- the function URL is kept in Vault too, so the job has no project-specific values in it
  if not exists (select 1 from vault.secrets where name = 'hrms_functions_url') then
    perform vault.create_secret('https://fatoruslncucjyoaxkrj.supabase.co/functions/v1', 'hrms_functions_url');
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'hrms-email-outbox';
  perform cron.schedule('hrms-email-outbox', '*/5 * * * *', $j$
    update public.email_outbox set status = 'queued' where status = 'sending' and created_at < now() - interval '15 minutes';
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'hrms_functions_url') || '/process-email-outbox',
      headers := jsonb_build_object('content-type', 'application/json',
                                    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hrms_cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000);
  $j$);
end $$;
