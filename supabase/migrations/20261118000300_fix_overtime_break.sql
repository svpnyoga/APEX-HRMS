-- Fix overtime: a normal shift day (e.g. 09:00-18:00 with a 60 min break) was credited ~60 min overtime,
-- because worked minutes include the break but the shift length had the break removed.

create or replace function public.recompute_attendance_day(p_employee uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_tz text; cs public.company_settings; sh record;
  ev record; v_open timestamptz; v_worked int := 0; v_first timestamptz; v_last timestamptz;
  v_late int := 0; v_early int := 0; v_ot int := 0; v_status text; v_shift_minutes int;
  v_shift_start timestamptz; v_shift_end timestamptz; v_missing boolean := false;
  v_is_late boolean := false; v_is_early boolean := false; v_flag boolean := false; v_offsite boolean := false;
  v_site uuid; v_leave uuid; v_leave_half boolean; v_regularised boolean;
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
    if cs.overtime_enabled and v_worked - v_shift_minutes >= cs.overtime_min_minutes then
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
     case when v_is_early then v_early else 0 end, v_ot, v_status, v_is_late, v_is_early, v_missing, v_offsite, v_flag, v_site, v_leave)
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

-- Recalculate existing records so wrong overtime does not reach payroll.
do $$
declare r record;
begin
  for r in select employee_id, work_date from public.attendance_records where overtime_minutes > 0 loop
    perform public.recompute_attendance_day(r.employee_id, r.work_date);
  end loop;
end $$;
