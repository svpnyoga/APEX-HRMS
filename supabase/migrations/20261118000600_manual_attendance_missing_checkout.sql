-- Manual attendance with only an in-time marked the day "regularised", which hid the missing check-out from
-- the dashboard ("Missing check-outs (7 days)") and from regularisation follow-up. A day only counts as
-- regularised once it has a check-out.

create or replace function public.manual_attendance(p_employee uuid, p_date date, p_in time, p_out time, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_tz text; v_org uuid;
begin
  if not public.has_permission('attendance.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.employees where id = p_employee and organisation_id = public.current_org_id();
  if v_org is null then raise exception 'Employee not found'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required for manual attendance'; end if;
  v_tz := public.org_timezone(v_org);
  delete from public.attendance_events where employee_id = p_employee and work_date = p_date and source = 'admin';
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

-- Re-open days that were marked regularised while still missing a check-out.
update public.attendance_records set is_regularised = false
 where is_regularised and missing_checkout and last_out is null;
