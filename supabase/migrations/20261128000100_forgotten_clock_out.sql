-- Forgotten clock-outs.
--
-- Problem: Nalini clocked in, forgot to clock out, and the next day the app still showed "Clock out", which the
-- server refused ("You have not clocked in yet"). She could not clock in at all.
--
-- 1. The app now starts every new day with "Clock in" (an open clock-in older than 20 hours no longer counts).
-- 2. close_forgotten_checkouts(): an open day is closed at the employee's SHIFT END (or at the clock-in time if they
--    clocked in after the shift ended), as an 'auto' clock-out. Hours count only up to shift end, it never creates
--    overtime, the day is flagged and listed under Missing Check-outs, and the employee is told to submit a
--    regularisation if they left at another time. Runs with the nightly close (00:15) and every 15 minutes, for days
--    whose shift ended over 2 hours ago (last 31 days). The "Missing check-out treatment" setting still applies:
--    half day / absent turn the day into that; "flag" keeps the hours up to shift end.
-- 3. send_checkout_reminders(): 30 minutes after shift end, anyone still clocked in gets one reminder.
-- A regularisation or manual attendance replaces the auto clock-out with the real time.
--
-- UNDO: select cron.unschedule('hrms-checkout-reminders'); select cron.unschedule('hrms-close-forgotten-checkouts');
--   re-run recompute_attendance_day (20261118000300), process_daily_attendance (20261105000400) and
--   manual_attendance (20261118000600); drop function public.close_forgotten_checkouts();
--   drop function public.send_checkout_reminders();

alter table public.attendance_events drop constraint if exists attendance_events_source_check;
alter table public.attendance_events add constraint attendance_events_source_check
  check (source in ('online','offline_sync','device','admin','auto'));
alter table public.attendance_records add column if not exists checkout_reminded_at timestamptz;

create or replace function public.recompute_attendance_day(p_employee uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_tz text; cs public.company_settings; sh record;
  ev record; v_open timestamptz; v_worked int := 0; v_first timestamptz; v_last timestamptz;
  v_late int := 0; v_early int := 0; v_ot int := 0; v_status text; v_shift_minutes int;
  v_shift_start timestamptz; v_shift_end timestamptz; v_missing boolean := false;
  v_is_late boolean := false; v_is_early boolean := false; v_flag boolean := false; v_offsite boolean := false;
  v_site uuid; v_leave uuid; v_leave_half boolean; v_regularised boolean; v_auto boolean := false;
begin
  select organisation_id into v_org from public.employees where id = p_employee;
  v_tz := public.org_timezone(v_org);
  select * into cs from public.company_settings where organisation_id = v_org;
  select * into sh from public.employee_shift(p_employee, p_date);
  v_shift_start := (p_date + sh.start_time) at time zone v_tz;
  v_shift_end := (case when sh.end_time <= sh.start_time then p_date + 1 else p_date end + sh.end_time) at time zone v_tz;
  -- worked_minutes is punch-in to punch-out (break included), so compare it with the full shift span.
  -- Subtracting the break here gave every normal 09:00-18:00 day an hour of overtime.
  v_shift_minutes := greatest(0, (extract(epoch from (v_shift_end - v_shift_start)) / 60)::int);

  -- pair in/out events in time order
  for ev in select * from public.attendance_events where employee_id = p_employee and work_date = p_date order by occurred_at, recorded_at loop
    if ev.is_flagged then v_flag := true; end if;
    if ev.event_type = 'out' and ev.source = 'auto' then v_auto := true; v_flag := true; end if;   -- forgotten clock-out closed by the system
    if ev.site_id is not null then v_site := ev.site_id; end if;
    if ev.within_geofence = false then v_offsite := true; end if;
    if ev.event_type = 'in' then
      if v_first is null then v_first := ev.occurred_at; end if;
      if v_open is null then v_open := ev.occurred_at; end if;
    else
      if v_open is not null then
        v_worked := v_worked + greatest(0, (extract(epoch from (ev.occurred_at - v_open)) / 60)::int);
        v_last := ev.occurred_at;
        v_open := null;
      end if;
    end if;
  end loop;
  v_missing := v_first is not null and v_open is not null;   -- still open
  if v_open is not null and v_last is null then v_last := null; end if;

  select la.id, la.is_half_day into v_leave, v_leave_half from public.leave_applications la
   where la.employee_id = p_employee and la.status = 'approved' and p_date between la.start_date and la.end_date
   limit 1;

  select coalesce(is_regularised, false) into v_regularised from public.attendance_records where employee_id = p_employee and work_date = p_date;

  if v_first is not null then
    if v_first > v_shift_start + make_interval(mins => sh.grace_minutes) then
      v_late := (extract(epoch from (v_first - v_shift_start)) / 60)::int;
      v_is_late := true;
    end if;
    if v_last is not null and not v_missing and v_last < v_shift_end - make_interval(mins => cs.early_departure_minutes) then
      v_early := (extract(epoch from (v_shift_end - v_last)) / 60)::int;
      v_is_early := true;
    end if;
    -- approved permissions excuse late / early
    if v_is_late and exists (select 1 from public.attendance_permissions p where p.employee_id = p_employee and p.work_date = p_date
         and p.status = 'approved' and ((p_date + p.from_time) at time zone v_tz) <= v_shift_start + make_interval(mins => sh.grace_minutes)
         and ((p_date + p.to_time) at time zone v_tz) >= v_first) then
      v_is_late := false;
    end if;
    if v_is_early and exists (select 1 from public.attendance_permissions p where p.employee_id = p_employee and p.work_date = p_date
         and p.status = 'approved' and ((p_date + p.from_time) at time zone v_tz) <= v_last
         and ((p_date + p.to_time) at time zone v_tz) >= v_shift_end - make_interval(mins => cs.early_departure_minutes)) then
      v_is_early := false;
    end if;
    if cs.overtime_enabled and not v_auto and v_worked - v_shift_minutes >= cs.overtime_min_minutes then
      v_ot := v_worked - v_shift_minutes;
    end if;
    if v_missing then
      v_status := 'incomplete';
    elsif v_worked >= cs.full_day_min_minutes or (v_leave_half and v_worked >= cs.half_day_min_minutes) then
      v_status := 'present';
    elsif v_worked >= cs.half_day_min_minutes then
      v_status := 'half_day';
    else
      v_status := 'half_day';   -- worked something but under half-day threshold; HR reviews
      v_flag := true;
    end if;
  elsif v_leave is not null and not coalesce(v_leave_half, false) then
    v_status := 'on_leave';
  elsif public.is_holiday(p_employee, p_date) then
    v_status := 'holiday';
  elsif extract(dow from p_date)::int = any(sh.weekly_off_days) then
    v_status := 'weekly_off';
  else
    v_status := 'absent';
  end if;

  insert into public.attendance_records(organisation_id, employee_id, work_date, shift_id, first_in, last_out, worked_minutes,
     late_minutes, early_minutes, overtime_minutes, status, is_late, is_early_departure, missing_checkout, is_offsite, is_flagged, site_id, leave_application_id)
  values (v_org, p_employee, p_date, sh.shift_id, v_first, v_last, v_worked, case when v_is_late then v_late else 0 end,
     case when v_is_early then v_early else 0 end, v_ot, v_status, v_is_late, v_is_early, v_missing or v_auto, v_offsite, v_flag, v_site, v_leave)
  on conflict (employee_id, work_date) do update set
     shift_id = excluded.shift_id, first_in = excluded.first_in, last_out = excluded.last_out, worked_minutes = excluded.worked_minutes,
     late_minutes = excluded.late_minutes, early_minutes = excluded.early_minutes, overtime_minutes = excluded.overtime_minutes,
     status = excluded.status, is_late = excluded.is_late, is_early_departure = excluded.is_early_departure,
     missing_checkout = excluded.missing_checkout, is_offsite = excluded.is_offsite,
     is_flagged = excluded.is_flagged or (attendance_records.is_flagged and attendance_records.is_regularised = false and excluded.is_flagged),
     site_id = excluded.site_id, leave_application_id = excluded.leave_application_id;

  -- maintain overtime record (pending approval) when overtime appears
  if v_ot > 0 then
    insert into public.overtime_records(organisation_id, employee_id, work_date, minutes)
    values (v_org, p_employee, p_date, v_ot)
    on conflict (employee_id, work_date) do update set minutes = excluded.minutes
      where overtime_records.status = 'pending';
  else
    delete from public.overtime_records where employee_id = p_employee and work_date = p_date and status = 'pending';
  end if;
end $$;

create or replace function public.close_forgotten_checkouts() returns int
language plpgsql security definer set search_path = public as $$
declare r record; sh record; cs public.company_settings; v_tz text; v_end timestamptz; v_out timestamptz; n int := 0;
begin
  for r in
    select * from (
      select distinct on (ev.employee_id, ev.work_date) ev.employee_id, ev.work_date, ev.event_type, ev.occurred_at, ev.organisation_id, e.user_id
        from public.attendance_events ev join public.employees e on e.id = ev.employee_id
       where ev.work_date >= current_date - 31
       order by ev.employee_id, ev.work_date, ev.occurred_at desc, ev.recorded_at desc) last_ev
     where event_type = 'in'
  loop
    v_tz := public.org_timezone(r.organisation_id);
    select * into sh from public.employee_shift(r.employee_id, r.work_date);
    v_end := (case when sh.end_time <= sh.start_time then r.work_date + 1 else r.work_date end + sh.end_time) at time zone v_tz;
    continue when now() < v_end + interval '2 hours';          -- give them time to clock out themselves
    v_out := greatest(v_end, r.occurred_at + interval '1 minute');
    continue when now() < v_out;
    insert into public.attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status, is_flagged, flag_reason, remarks)
    values (r.organisation_id, r.employee_id, 'out', r.work_date, v_out, 'manual', 'auto', 'disabled', true,
            'auto clock-out (forgot to clock out)', 'Clock-out missing: closed automatically at shift end');
    perform public.recompute_attendance_day(r.employee_id, r.work_date);
    select * into cs from public.company_settings where organisation_id = r.organisation_id;
    if cs.missing_checkout_policy in ('half_day','absent') then
      update public.attendance_records set status = cs.missing_checkout_policy
       where employee_id = r.employee_id and work_date = r.work_date and not is_regularised;
    end if;
    update public.attendance_records set remarks = 'Clock-out missing: set to shift end ' || to_char(v_out at time zone v_tz, 'HH12:MI AM')
     where employee_id = r.employee_id and work_date = r.work_date and not is_regularised;
    if r.user_id is not null then
      perform public.notify(r.user_id, 'attendance', 'attendance.missing_checkout',
        jsonb_build_object('title', 'Missing clock-out on ' || to_char(r.work_date, 'DD Mon'), 'date', to_char(r.work_date, 'DD Mon YYYY'),
                           'time', to_char(v_out at time zone v_tz, 'HH12:MI AM')), '/me/attendance');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.close_forgotten_checkouts() from public, anon, authenticated;

create or replace function public.send_checkout_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; sh record; v_tz text; v_end timestamptz; n int := 0;
begin
  for r in
    select * from (
      select distinct on (ev.employee_id) ev.employee_id, ev.work_date, ev.event_type, ev.occurred_at, ev.organisation_id, e.user_id
        from public.attendance_events ev join public.employees e on e.id = ev.employee_id
       where ev.occurred_at > now() - interval '20 hours'
       order by ev.employee_id, ev.occurred_at desc, ev.recorded_at desc) last_ev
     where event_type = 'in' and user_id is not null
  loop
    v_tz := public.org_timezone(r.organisation_id);
    select * into sh from public.employee_shift(r.employee_id, r.work_date);
    v_end := (case when sh.end_time <= sh.start_time then r.work_date + 1 else r.work_date end + sh.end_time) at time zone v_tz;
    continue when now() < v_end + interval '30 minutes' or r.occurred_at > v_end;   -- not for people who started after shift end
    update public.attendance_records set checkout_reminded_at = now()
     where employee_id = r.employee_id and work_date = r.work_date and checkout_reminded_at is null;
    continue when not found;
    perform public.notify(r.user_id, 'attendance', 'attendance.checkout_reminder',
      jsonb_build_object('title', 'Still clocked in?', 'time', to_char(v_end at time zone v_tz, 'HH12:MI AM')), '/me/attendance');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.send_checkout_reminders() from public, anon, authenticated;

create or replace function public.process_daily_attendance(p_date date default (current_date - 1)) returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int := 0; cs public.company_settings;
begin
  perform public.close_forgotten_checkouts();   -- forgotten clock-outs are closed at shift end first
  for e in select id, organisation_id, user_id from public.employees
           where status in ('active','probation','notice') and deleted_at is null and date_of_joining <= p_date loop
    perform public.recompute_attendance_day(e.id, p_date);
    select * into cs from public.company_settings where organisation_id = e.organisation_id;
    -- open sessions after the day closes become missing check-outs per policy
    update public.attendance_records set
      status = case cs.missing_checkout_policy when 'half_day' then 'half_day' when 'absent' then 'absent' else 'incomplete' end,
      missing_checkout = true, is_flagged = true
    where employee_id = e.id and work_date = p_date and missing_checkout and last_out is null and not is_regularised;   -- still open (e.g. a night shift not yet over)
    if found then
      perform public.notify(e.user_id, 'attendance', 'attendance.missing_checkout',
        jsonb_build_object('title','Missing check-out on ' || to_char(p_date,'DD Mon'), 'date', to_char(p_date,'DD Mon YYYY')), '/me/attendance');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- manual attendance replaces an automatic clock-out too
create or replace function public.manual_attendance(p_employee uuid, p_date date, p_in time, p_out time, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_org uuid;
begin
  if not public.has_permission('attendance.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.employees where id = p_employee and organisation_id = public.current_org_id();
  if v_org is null then raise exception 'Employee not found'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required for manual attendance'; end if;
  v_tz := public.org_timezone(v_org);
  delete from public.attendance_events where employee_id = p_employee and work_date = p_date and source in ('admin', 'auto');
  if p_in is not null then
    insert into public.attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status, remarks, created_by)
    values (v_org, p_employee, 'in', p_date, (p_date + p_in) at time zone v_tz, 'manual', 'admin', 'disabled', p_reason, auth.uid());
  end if;
  if p_out is not null then
    insert into public.attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status, remarks, created_by)
    values (v_org, p_employee, 'out', p_date, (case when p_out < p_in then p_date + 1 else p_date end + p_out) at time zone v_tz, 'manual', 'admin', 'disabled', p_reason, auth.uid());
  end if;
  perform public.recompute_attendance_day(p_employee, p_date);
  update public.attendance_records set is_regularised = not missing_checkout, remarks = p_reason, is_flagged = false where employee_id = p_employee and work_date = p_date;
  perform public.log_action('MANUAL_ATTENDANCE', 'attendance_records', p_employee::text || '@' || p_date, p_reason);
end $$;

update public.notification_templates set body_template =
  'You did not clock out on {{date}}, so your clock-out was set to the shift end ({{time}}). If you left at a different time, submit a regularisation request.'
 where organisation_id is null and code = 'attendance.missing_checkout';
insert into public.notification_templates(organisation_id, code, title_template, body_template, send_email)
select null, 'attendance.checkout_reminder', '{{title}}', 'Your shift ended at {{time}} and you are still clocked in. Please clock out when you leave.', true
 where not exists (select 1 from public.notification_templates where organisation_id is null and code = 'attendance.checkout_reminder');

-- close what is already open now (e.g. Nalini's day), then schedule
select public.close_forgotten_checkouts();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hrms-close-attendance-day', '45 18 * * *', $j$select public.process_daily_attendance((now() at time zone 'Asia/Kolkata')::date - 1)$j$);
    perform cron.schedule('hrms-close-forgotten-checkouts', '7,22,37,52 * * * *', $j$select public.close_forgotten_checkouts()$j$);
    perform cron.schedule('hrms-checkout-reminders', '*/15 * * * *', $j$select public.send_checkout_reminders()$j$);
  else
    raise notice 'pg_cron not enabled: forgotten clock-outs close only when process_daily_attendance runs';
  end if;
end $$;
