-- Clock-in location check:
--  • a punch with no site chosen is checked against the employee's primary site, else the company office
--    (previously no check at all happened, so "Not at a specific site" skipped the geofence)
--  • the GPS-error allowance is capped at the required accuracy (150 m by default) instead of 500 m

create or replace function public._record_attendance_event(
  p_employee uuid, p_event_type text, p_method text, p_source text, p_occurred_at timestamptz,
  p_site_id uuid, p_new_site_name text, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_gps_status text, p_client_event_id text, p_face_attempt uuid, p_device uuid, p_remarks text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.employees; cs public.company_settings; v_tz text; v_at timestamptz; v_date date;
  v_last record; v_site public.work_sites; gs public.geofence_settings; v_dist double precision; v_within boolean;
  v_flag boolean := false; v_reasons text[] := '{}'; v_id uuid; v_existing uuid; v_type text := p_event_type; v_gps text := coalesce(p_gps_status, 'unavailable');
  v_rec public.attendance_records;
begin
  select * into e from public.employees where id = p_employee;
  if not found or e.status in ('exited','inactive') then raise exception 'Employee is not active'; end if;
  select * into cs from public.company_settings where organisation_id = e.organisation_id;
  v_tz := public.org_timezone(e.organisation_id);

  -- idempotency: replays of the same client event return the original
  if p_client_event_id is not null then
    select id into v_existing from public.attendance_events where employee_id = p_employee and client_event_id = p_client_event_id;
    if v_existing is not null then
      return jsonb_build_object('event_id', v_existing, 'duplicate', true);
    end if;
  end if;

  -- trusted time: server clock for live punches; bounded client clock for offline/device
  if p_source in ('online') then
    v_at := now();
  else
    v_at := coalesce(p_occurred_at, now());
    if v_at > now() + interval '2 minutes' then raise exception 'Punch time is in the future'; end if;
    if v_at < now() - make_interval(hours => cs.offline_max_age_hours) and p_source <> 'admin' then
      raise exception 'Offline punch is older than % hours; submit a regularisation request instead', cs.offline_max_age_hours;
    end if;
    if p_source = 'offline_sync' then v_flag := true; v_reasons := v_reasons || 'offline punch'; end if;
  end if;
  v_date := (v_at at time zone v_tz)::date;

  -- auto direction: 'auto' toggles based on the open session
  select * into v_last from public.attendance_events where employee_id = p_employee and occurred_at <= v_at order by occurred_at desc limit 1;
  if v_type = 'auto' then
    v_type := case when v_last.event_type = 'in' and v_last.occurred_at > v_at - interval '20 hours' then 'out' else 'in' end;
  end if;
  -- an 'out' after midnight belongs to yesterday's open session
  if v_type = 'out' and v_last.event_type = 'in' and v_last.work_date < v_date and v_last.occurred_at > v_at - interval '20 hours' then
    v_date := v_last.work_date;
  end if;
  -- sequence rules (strict online, flag offline)
  if v_type = 'in' and v_last.event_type = 'in' and v_last.work_date = v_date then
    if p_source = 'online' then raise exception 'You are already clocked in. Clock out first.'; end if;
    v_flag := true; v_reasons := v_reasons || 'consecutive check-ins';
  elsif v_type = 'out' and (v_last.event_type is null or v_last.event_type = 'out' or v_last.work_date <> v_date) then
    if p_source = 'online' then raise exception 'You have not clocked in yet.'; end if;
    v_flag := true; v_reasons := v_reasons || 'check-out without check-in';
  end if;

  -- site resolution; new sites are created unapproved and flagged for HR
  if p_site_id is null and coalesce(trim(p_new_site_name), '') <> '' then
    if not cs.allow_new_site_entry then raise exception 'New sites are not allowed; choose an assigned site'; end if;
    insert into public.work_sites(organisation_id, name, site_type, latitude, longitude, is_approved, created_by)
    values (e.organisation_id, trim(p_new_site_name), 'customer', p_lat, p_lng, false, auth.uid()) returning * into v_site;
    v_flag := true; v_reasons := v_reasons || 'new site pending approval';
  elsif p_site_id is not null then
    select * into v_site from public.work_sites where id = p_site_id and organisation_id = e.organisation_id;
    if not found then raise exception 'Unknown site'; end if;
  end if;

  -- no site chosen: check against the employee's primary site, or else the company's office,
  -- so "not at a specific site" can't be used to skip the location check
  if v_site.id is null then
    select s.* into v_site from public.employee_site_assignments a join public.work_sites s on s.id = a.site_id
     where a.employee_id = p_employee and a.is_primary and s.is_active and s.is_approved
       and a.valid_from <= v_date and (a.valid_to is null or a.valid_to >= v_date)
     order by a.valid_from desc limit 1;
    if v_site.id is null then
      select * into v_site from public.work_sites
       where organisation_id = e.organisation_id and site_type = 'office' and is_active and is_approved
       order by created_at limit 1;
    end if;
  end if;

  -- geofence: informational / flag only. GPS failures never block attendance.
  if cs.gps_mode <> 'off' and p_lat is not null and p_lng is not null and v_site.latitude is not null then
    select * into gs from public.geofence_settings where organisation_id = e.organisation_id and (site_id = v_site.id or site_id is null)
      order by site_id nulls last limit 1;
    v_dist := public.geo_distance_m(p_lat, p_lng, v_site.latitude, v_site.longitude);
    -- allowance for GPS error is capped at the "required accuracy" (default 150 m), not 500 m
    v_within := v_dist <= v_site.radius_m + coalesce(gs.extra_tolerance_m, 50) + least(coalesce(p_accuracy, 0), coalesce(gs.require_accuracy_m, 150));
    if p_accuracy is not null and p_accuracy > coalesce(gs.require_accuracy_m, 150) then v_gps := 'low_accuracy'; end if;
    if not v_within and cs.gps_mode = 'flag' and coalesce(gs.mode, 'flag') = 'flag' then
      v_flag := true; v_reasons := v_reasons || format('%s m outside site', round(v_dist - v_site.radius_m));
    end if;
  elsif cs.gps_mode = 'off' then
    v_gps := 'disabled';
  end if;

  insert into public.attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method, source, site_id,
    latitude, longitude, accuracy_m, gps_status, distance_from_site_m, within_geofence, face_attempt_id, device_id, client_event_id,
    is_flagged, flag_reason, remarks, created_by)
  values (e.organisation_id, p_employee, v_type, v_date, v_at, p_method, p_source, v_site.id,
    case when cs.gps_mode = 'off' then null else p_lat end, case when cs.gps_mode = 'off' then null else p_lng end, p_accuracy,
    v_gps, v_dist, v_within, p_face_attempt, p_device, p_client_event_id,
    v_flag, nullif(array_to_string(v_reasons, '; '), ''), p_remarks, auth.uid())
  returning id into v_id;

  perform public.recompute_attendance_day(p_employee, v_date);
  select * into v_rec from public.attendance_records where employee_id = p_employee and work_date = v_date;

  return jsonb_build_object('event_id', v_id, 'event_type', v_type, 'occurred_at', v_at, 'work_date', v_date,
    'flagged', v_flag, 'flag_reason', array_to_string(v_reasons, '; '), 'within_geofence', v_within,
    'status', v_rec.status, 'is_late', v_rec.is_late, 'late_minutes', v_rec.late_minutes, 'worked_minutes', v_rec.worked_minutes,
    'duplicate', false);
end $$;
