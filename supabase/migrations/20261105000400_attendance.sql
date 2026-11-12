-- =====================================================================
-- 0004 TIME & ATTENDANCE, FACE RECOGNITION, SITES
-- All attendance rules (grace, late, early, overtime, missing check-out,
-- geofence flags, offline sync, idempotency) are enforced here, server side.
-- =====================================================================

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  code text,
  start_time time not null,
  end_time time not null,
  break_minutes int not null default 60 check (break_minutes >= 0),
  grace_minutes int,                      -- null = company default
  is_night_shift boolean not null default false,
  weekly_off_days int[],                  -- null = company default
  is_default boolean not null default false,
  is_active boolean not null default true,
  color text default '#4338CA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);
create unique index shifts_one_default on public.shifts(organisation_id) where is_default;
create trigger trg_shifts_updated before update on public.shifts for each row execute function public.set_updated_at();

alter table public.employees add constraint employees_shift_fk foreign key (shift_id) references public.shifts(id) on delete set null;

create table public.attendance_schedules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_id uuid not null references public.shifts(id),
  effective_from date not null,
  effective_to date,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index on public.attendance_schedules(employee_id, effective_from);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  holiday_type text not null default 'public' check (holiday_type in ('public','festival','optional','company')),
  location_id uuid references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (organisation_id, holiday_date, location_id)
);

create table public.work_sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  site_type text not null default 'office' check (site_type in ('office','plant','customer','warehouse','other')),
  client_name text,
  address text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  radius_m int not null default 200 check (radius_m between 20 and 5000),
  is_approved boolean not null default true,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.work_sites(organisation_id, is_active);
create trigger trg_sites_updated before update on public.work_sites for each row execute function public.set_updated_at();

create table public.employee_site_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  site_id uuid not null references public.work_sites(id) on delete cascade,
  is_primary boolean not null default false,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  unique (employee_id, site_id, valid_from)
);

create table public.geofence_settings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  site_id uuid references public.work_sites(id) on delete cascade,  -- null = organisation default
  mode text not null default 'flag' check (mode in ('off','record','flag')),
  extra_tolerance_m int not null default 50,
  require_accuracy_m int not null default 150,
  unique (organisation_id, site_id)
);

create table public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  device_type text not null check (device_type in ('fingerprint','face_terminal','rfid','kiosk')),
  vendor text,
  serial_number text,
  site_id uuid references public.work_sites(id),
  api_key_hash text,                     -- sha256 of device key; key shown once
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, serial_number)
);

create table public.device_user_mappings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.attendance_devices(id) on delete cascade,
  device_user_code text not null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  unique (device_id, device_user_code)
);

-- consent for biometric & location processing (DPDP-style explicit consent)
create table public.data_consents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  consent_type text not null check (consent_type in ('biometric','location')),
  policy_version text not null default 'v1',
  granted boolean not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text
);
create index on public.data_consents(employee_id, consent_type, granted_at desc);

create or replace function public.has_consent(p_employee uuid, p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select granted and revoked_at is null from public.data_consents
                   where employee_id = p_employee and consent_type = p_type order by granted_at desc limit 1), false)
$$;

-- ---------- face recognition ----------
create table public.face_enrolments (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  status text not null default 'not_enrolled' check (status in ('not_enrolled','enrolled','revoked')),
  model text,
  samples_count int not null default 0,
  avg_quality numeric(5,3),
  enrolled_at timestamptz,
  enrolled_by uuid,
  updated_at timestamptz not null default now()
);

-- templates are NEVER readable by clients; only SECURITY DEFINER matching reads them
create table public.face_templates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  model text not null,
  embedding vector not null,
  quality numeric(5,3),
  sample_index int not null,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.face_templates(employee_id, model) where is_active;

create table public.face_recognition_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  mode text not null check (mode in ('verify','identify','enrol_test')),
  model text,
  similarity numeric(5,3),
  antispoof_score numeric(5,3),
  liveness_score numeric(5,3),
  challenge_passed boolean,
  quality numeric(5,3),
  outcome text not null check (outcome in ('matched','no_match','spoof_suspected','liveness_failed','not_enrolled','rate_limited','no_consent','error')),
  reason text,
  device_id uuid references public.attendance_devices(id),
  user_agent text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.face_recognition_attempts(organisation_id, created_at desc);
create index on public.face_recognition_attempts(employee_id, created_at desc);

-- ---------- attendance ----------
create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  event_type text not null check (event_type in ('in','out')),
  work_date date not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  method text not null check (method in ('face','biometric','manual','web','kiosk','field')),
  source text not null default 'online' check (source in ('online','offline_sync','device','admin')),
  site_id uuid references public.work_sites(id),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  gps_status text not null default 'unavailable' check (gps_status in ('ok','unavailable','denied','disabled','low_accuracy')),
  distance_from_site_m double precision,
  within_geofence boolean,
  face_attempt_id uuid references public.face_recognition_attempts(id),
  device_id uuid references public.attendance_devices(id),
  client_event_id text,
  is_flagged boolean not null default false,
  flag_reason text,
  remarks text,
  created_by uuid,
  unique (employee_id, client_event_id)
);
create index on public.attendance_events(employee_id, work_date);
create index on public.attendance_events(organisation_id, occurred_at desc);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  shift_id uuid references public.shifts(id),
  first_in timestamptz,
  last_out timestamptz,
  worked_minutes int not null default 0,
  late_minutes int not null default 0,
  early_minutes int not null default 0,
  overtime_minutes int not null default 0,
  status text not null default 'absent' check (status in ('present','half_day','absent','on_leave','holiday','weekly_off','incomplete')),
  is_late boolean not null default false,
  is_early_departure boolean not null default false,
  missing_checkout boolean not null default false,
  is_offsite boolean not null default false,
  is_regularised boolean not null default false,
  is_flagged boolean not null default false,
  site_id uuid references public.work_sites(id),
  leave_application_id uuid,
  remarks text,
  absence_confirmed_by uuid,
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index on public.attendance_records(organisation_id, work_date);
create trigger trg_att_records_updated before update on public.attendance_records for each row execute function public.set_updated_at();

create table public.attendance_regularisation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  requested_in time,
  requested_out time,
  reason text not null,
  request_type text not null default 'missed_punch' check (request_type in ('missed_punch','wrong_punch','on_duty','work_from_home','other')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now()
);
create index on public.attendance_regularisation(employee_id, work_date);

create table public.attendance_permissions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  from_time time not null,
  to_time time not null,
  minutes int generated always as ((extract(epoch from (to_time - from_time)) / 60)::int) stored,
  permission_type text not null default 'personal' check (permission_type in ('personal','official')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_time > from_time)
);

create table public.overtime_records (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  minutes int not null check (minutes >= 0),
  approved_minutes int,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  payroll_run_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- field location pings (consent + tracking window enforced in record_location_ping)
create table public.field_location_records (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  speed_mps double precision,
  battery_pct int,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null default 'foreground' check (source in ('foreground','background','checkin','checkout','visit'))
);
create index on public.field_location_records(employee_id, recorded_at desc);
create index on public.field_location_records(organisation_id, recorded_at desc);

create table public.field_visits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  site_id uuid references public.work_sites(id),
  purpose text not null,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  check_in_lat double precision, check_in_lng double precision,
  check_out_lat double precision, check_out_lng double precision,
  outcome text,
  notes text,
  created_at timestamptz not null default now()
);
create index on public.field_visits(employee_id, check_in_at desc);

-- ---------- helpers ----------
create or replace function public.geo_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create or replace function public.org_timezone(p_org uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from public.organisations where id = p_org), 'Asia/Kolkata')
$$;

-- effective shift for an employee on a date (schedule > employee shift > org default)
create or replace function public.employee_shift(p_employee uuid, p_date date)
returns table (shift_id uuid, start_time time, end_time time, break_minutes int, grace_minutes int, weekly_off_days int[])
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_shift uuid; cs public.company_settings; s public.shifts;
begin
  select e.organisation_id, e.shift_id into v_org, v_shift from public.employees e where e.id = p_employee;
  select * into cs from public.company_settings where organisation_id = v_org;
  select a.shift_id into s.id from public.attendance_schedules a
   where a.employee_id = p_employee and p_date >= a.effective_from and (a.effective_to is null or p_date <= a.effective_to)
   order by a.effective_from desc limit 1;
  if s.id is null then s.id := v_shift; end if;
  if s.id is null then select x.id into s.id from public.shifts x where x.organisation_id = v_org and x.is_default and x.is_active; end if;
  if s.id is not null then select * into s from public.shifts where id = s.id; end if;
  return query select s.id,
    coalesce(s.start_time, cs.reporting_time), coalesce(s.end_time, cs.end_time),
    coalesce(s.break_minutes, 60), coalesce(s.grace_minutes, cs.grace_minutes),
    coalesce(s.weekly_off_days, cs.weekly_off_days);
end $$;

create or replace function public.is_holiday(p_employee uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.holidays h join public.employees e on e.organisation_id = h.organisation_id
                 where e.id = p_employee and h.holiday_date = p_date
                   and h.holiday_type <> 'optional'
                   and (h.location_id is null or h.location_id = e.location_id))
$$;

create or replace function public.is_weekly_off(p_employee uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(extract(dow from p_date)::int = any(s.weekly_off_days), false) from public.employee_shift(p_employee, p_date) s
$$;

-- ---------- core computation ----------
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
  v_shift_minutes := greatest(0, (extract(epoch from (v_shift_end - v_shift_start)) / 60)::int - sh.break_minutes);

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

-- INTERNAL: insert one punch with all validation. Never granted to clients.
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

  -- geofence: informational / flag only. GPS failures never block attendance.
  if cs.gps_mode <> 'off' and p_lat is not null and p_lng is not null and v_site.latitude is not null then
    select * into gs from public.geofence_settings where organisation_id = e.organisation_id and (site_id = v_site.id or site_id is null)
      order by site_id nulls last limit 1;
    v_dist := public.geo_distance_m(p_lat, p_lng, v_site.latitude, v_site.longitude);
    v_within := v_dist <= v_site.radius_m + coalesce(gs.extra_tolerance_m, 50) + least(coalesce(p_accuracy, 0), 500);
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

-- PUBLIC: web/mobile punch without face (only when the org does not require face)
create or replace function public.clock_event(
  p_event_type text, p_site_id uuid default null, p_new_site_name text default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_gps_status text default null, p_client_event_id text default null, p_occurred_at timestamptz default null, p_offline boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); cs public.company_settings;
begin
  if v_emp is null then raise exception 'Your login is not linked to an employee record'; end if;
  if not public.has_permission('attendance.clock') then raise exception 'Not authorised to record attendance' using errcode = '42501'; end if;
  select * into cs from public.company_settings where organisation_id = public.current_org_id();
  if cs.face_recognition_enabled and cs.face_required_for_clock then
    raise exception 'Face verification is required to record attendance';
  end if;
  return public._record_attendance_event(v_emp, p_event_type, 'web', case when p_offline then 'offline_sync' else 'online' end,
    p_occurred_at, p_site_id, p_new_site_name, p_lat, p_lng, p_accuracy, p_gps_status, p_client_event_id, null, null, null);
end $$;

-- ---------- face matching ----------
-- Similarity is model-specific so the provider stays replaceable.
--  human-faceres-v1 : replicates Human's normalized euclidean similarity (0..1, >0.5 = same person by vendor guidance)
--  cosine models    : 1 - cosine distance (e.g. ArcFace/AdaFace/Rekognition-style embeddings)
create or replace function public.face_similarity(p_model text, a vector, b vector) returns double precision
language plpgsql immutable as $$
begin
  if vector_dims(a) <> vector_dims(b) then return 0; end if;
  if p_model like 'human-faceres%' then
    return greatest(0, least(1, (0.8 - (a <-> b) / 20.0) / 0.6));
  else
    return greatest(0, least(1, 1 - (a <=> b)));
  end if;
end $$;

create or replace function public._face_log(
  p_org uuid, p_emp uuid, p_mode text, p_model text, p_sim double precision, p_spoof numeric, p_live numeric,
  p_challenge boolean, p_quality numeric, p_outcome text, p_reason text, p_device uuid
) returns uuid
language sql security definer set search_path = public as $$
  insert into public.face_recognition_attempts(organisation_id, employee_id, mode, model, similarity, antispoof_score, liveness_score,
     challenge_passed, quality, outcome, reason, device_id, created_by)
  values (p_org, p_emp, p_mode, p_model, p_sim, p_spoof, p_live, p_challenge, p_quality, p_outcome, p_reason, p_device, auth.uid())
  returning id
$$;

-- evaluates liveness + match for one employee; returns attempt id & outcome
create or replace function public._face_evaluate(
  p_emp uuid, p_embedding vector, p_model text, p_antispoof numeric, p_liveness numeric, p_challenge boolean, p_quality numeric, p_mode text, p_device uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; cs public.company_settings; v_sim double precision; v_recent int; v_outcome text; v_reason text; v_attempt uuid;
begin
  select organisation_id into v_org from public.employees where id = p_emp;
  select * into cs from public.company_settings where organisation_id = v_org;
  select count(*) into v_recent from public.face_recognition_attempts
   where employee_id = p_emp and created_at > now() - interval '1 hour' and outcome <> 'matched';
  if v_recent >= cs.face_max_attempts_per_hour then
    v_outcome := 'rate_limited'; v_reason := 'Too many failed attempts in the last hour';
  elsif not public.has_consent(p_emp, 'biometric') then
    v_outcome := 'no_consent'; v_reason := 'Biometric consent not recorded';
  elsif not exists (select 1 from public.face_templates where employee_id = p_emp and model = p_model and is_active) then
    v_outcome := 'not_enrolled'; v_reason := 'No active face templates for this model';
  elsif coalesce(p_antispoof, 0) < cs.face_antispoof_threshold then
    v_outcome := 'spoof_suspected'; v_reason := 'Anti-spoofing score below threshold';
  elsif coalesce(p_liveness, 0) < cs.face_liveness_threshold or not coalesce(p_challenge, false) then
    v_outcome := 'liveness_failed'; v_reason := 'Liveness check not passed';
  else
    -- mean of the top-3 sample similarities resists a single lucky sample
    select avg(s) filter (where rn <= 3) into v_sim
    from (select public.face_similarity(p_model, embedding, p_embedding) s,
                 row_number() over (order by public.face_similarity(p_model, embedding, p_embedding) desc) rn
          from public.face_templates where employee_id = p_emp and model = p_model and is_active) x;
    if v_sim >= cs.face_match_threshold then v_outcome := 'matched'; else v_outcome := 'no_match'; v_reason := 'Face did not match enrolled templates'; end if;
  end if;
  v_attempt := public._face_log(v_org, p_emp, p_mode, p_model, v_sim, p_antispoof, p_liveness, p_challenge, p_quality, v_outcome, v_reason, p_device);
  return jsonb_build_object('attempt_id', v_attempt, 'outcome', v_outcome, 'similarity', round(coalesce(v_sim,0)::numeric, 3),
                            'threshold', cs.face_match_threshold, 'reason', v_reason);
end $$;

-- PUBLIC: 1:1 verification of the signed-in employee, then punch
create or replace function public.face_clock(
  p_embedding text, p_model text, p_antispoof numeric, p_liveness numeric, p_challenge_passed boolean, p_quality numeric,
  p_event_type text default 'auto', p_site_id uuid default null, p_new_site_name text default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_gps_status text default null, p_client_event_id text default null, p_occurred_at timestamptz default null, p_offline boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_eval jsonb; v_event jsonb;
begin
  if v_emp is null then raise exception 'Your login is not linked to an employee record'; end if;
  if not public.has_permission('attendance.clock') then raise exception 'Not authorised to record attendance' using errcode = '42501'; end if;
  -- idempotent replay of an already-synced offline punch
  if p_client_event_id is not null and exists (select 1 from public.attendance_events where employee_id = v_emp and client_event_id = p_client_event_id) then
    return jsonb_build_object('outcome','matched','duplicate',true);
  end if;
  v_eval := public._face_evaluate(v_emp, p_embedding::vector, p_model, p_antispoof, p_liveness, p_challenge_passed, p_quality, 'verify', null);
  if v_eval->>'outcome' <> 'matched' then return v_eval; end if;
  v_event := public._record_attendance_event(v_emp, p_event_type, 'face', case when p_offline then 'offline_sync' else 'online' end,
     p_occurred_at, p_site_id, p_new_site_name, p_lat, p_lng, p_accuracy, p_gps_status, p_client_event_id,
     (v_eval->>'attempt_id')::uuid, null, null);
  return v_eval || v_event;
end $$;

-- PUBLIC (kiosk role): 1:N identification on a shared, supervised device
create or replace function public.kiosk_identify_clock(
  p_embedding text, p_model text, p_antispoof numeric, p_liveness numeric, p_challenge_passed boolean, p_quality numeric,
  p_site_id uuid default null, p_device_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_vec vector := p_embedding::vector; v_best uuid; v_sim double precision; v_second double precision;
  v_eval jsonb; v_event jsonb; cs public.company_settings;
begin
  if not public.has_permission('attendance.kiosk') then raise exception 'This account is not a kiosk' using errcode = '42501'; end if;
  select * into cs from public.company_settings where organisation_id = v_org;
  select employee_id, s into v_best, v_sim from (
    select t.employee_id, max(public.face_similarity(p_model, t.embedding, v_vec)) s
    from public.face_templates t join public.employees e on e.id = t.employee_id
    where e.organisation_id = v_org and e.status not in ('exited','inactive') and t.model = p_model and t.is_active
    group by t.employee_id order by s desc limit 1) x;
  select max(s) into v_second from (
    select max(public.face_similarity(p_model, t.embedding, v_vec)) s from public.face_templates t join public.employees e on e.id = t.employee_id
    where e.organisation_id = v_org and t.model = p_model and t.is_active and t.employee_id <> v_best group by t.employee_id) y;
  -- reject ambiguous identifications (two people too close)
  if v_best is null or v_sim < cs.face_match_threshold or (v_second is not null and v_sim - v_second < 0.05) then
    perform public._face_log(v_org, null, 'identify', p_model, v_sim, p_antispoof, p_liveness, p_challenge_passed, p_quality, 'no_match',
      case when v_best is null then 'Nobody enrolled' else 'No confident match' end, p_device_id);
    return jsonb_build_object('outcome','no_match','similarity', round(coalesce(v_sim,0)::numeric,3));
  end if;
  v_eval := public._face_evaluate(v_best, v_vec, p_model, p_antispoof, p_liveness, p_challenge_passed, p_quality, 'identify', p_device_id);
  if v_eval->>'outcome' <> 'matched' then return v_eval; end if;
  v_event := public._record_attendance_event(v_best, 'auto', 'kiosk', 'online', null, p_site_id, null, null, null, null, 'disabled', null,
    (v_eval->>'attempt_id')::uuid, p_device_id, null);
  return v_eval || v_event || jsonb_build_object('employee_id', v_best, 'employee_name', public.employee_name(v_best));
end $$;

-- PUBLIC (HR): enrol multiple samples for an employee
create or replace function public.face_enrol(p_employee uuid, p_model text, p_embeddings jsonb, p_qualities jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int; v_min int; i int; v_q numeric; v_qsum numeric := 0;
begin
  if not public.has_permission('attendance.face_enrol') then raise exception 'Only HR/admin can enrol faces' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where id = p_employee and organisation_id = public.current_org_id()) then raise exception 'Employee not found'; end if;
  if not public.has_consent(p_employee, 'biometric') then raise exception 'Record the employee''s biometric consent before enrolment'; end if;
  select face_min_samples into v_min from public.company_settings where organisation_id = public.current_org_id();
  v_n := jsonb_array_length(p_embeddings);
  if v_n < v_min then raise exception 'At least % good samples are required (got %)', v_min, v_n; end if;
  update public.face_templates set is_active = false where employee_id = p_employee;
  for i in 0 .. v_n - 1 loop
    v_q := coalesce((p_qualities->>i)::numeric, null);
    v_qsum := v_qsum + coalesce(v_q, 0);
    insert into public.face_templates(employee_id, model, embedding, quality, sample_index, created_by)
    values (p_employee, p_model, (p_embeddings->i)::text::vector, v_q, i + 1, auth.uid());
  end loop;
  insert into public.face_enrolments(employee_id, status, model, samples_count, avg_quality, enrolled_at, enrolled_by)
  values (p_employee, 'enrolled', p_model, v_n, round(v_qsum / v_n, 3), now(), auth.uid())
  on conflict (employee_id) do update set status = 'enrolled', model = excluded.model, samples_count = excluded.samples_count,
    avg_quality = excluded.avg_quality, enrolled_at = now(), enrolled_by = auth.uid(), updated_at = now();
  perform public.log_action('FACE_ENROL', 'face_templates', p_employee::text, format('%s samples, model %s', v_n, p_model));
  return jsonb_build_object('samples', v_n);
end $$;

-- PUBLIC (HR): test a live capture against an employee without punching (threshold calibration)
create or replace function public.face_test_match(p_employee uuid, p_embedding text, p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sim double precision;
begin
  if not public.has_permission('attendance.face_enrol') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select max(public.face_similarity(p_model, embedding, p_embedding::vector)) into v_sim
  from public.face_templates t join public.employees e on e.id = t.employee_id
  where t.employee_id = p_employee and e.organisation_id = public.current_org_id() and t.model = p_model and t.is_active;
  perform public._face_log(public.current_org_id(), p_employee, 'enrol_test', p_model, v_sim, null, null, null, null,
     case when v_sim is null then 'not_enrolled' when v_sim >= (select face_match_threshold from public.company_settings where organisation_id = public.current_org_id()) then 'matched' else 'no_match' end,
     'HR test', null);
  return jsonb_build_object('similarity', round(coalesce(v_sim,0)::numeric,3));
end $$;

create or replace function public.face_revoke_enrolment(p_employee uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_permission('attendance.face_enrol') or p_employee = public.current_employee_id()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  delete from public.face_templates where employee_id = p_employee;
  update public.face_enrolments set status = 'revoked', samples_count = 0, updated_at = now() where employee_id = p_employee;
  perform public.log_action('FACE_REVOKE', 'face_templates', p_employee::text, p_reason);
end $$;

-- PUBLIC: employee records / withdraws consent. Withdrawing biometric consent deletes templates.
create or replace function public.record_consent(p_type text, p_granted boolean, p_policy_version text default 'v1', p_user_agent text default null, p_employee uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := coalesce(p_employee, public.current_employee_id());
begin
  if v_emp <> public.current_employee_id() and not public.has_permission('attendance.face_enrol') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.data_consents set revoked_at = now() where employee_id = v_emp and consent_type = p_type and revoked_at is null;
  insert into public.data_consents(employee_id, consent_type, policy_version, granted, user_agent) values (v_emp, p_type, p_policy_version, p_granted, p_user_agent);
  if p_type = 'biometric' and not p_granted then
    perform public.face_revoke_enrolment(v_emp, 'Consent withdrawn');
  end if;
end $$;

-- ---------- HR operations ----------
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
  update public.attendance_records set is_regularised = true, remarks = p_reason, is_flagged = false where employee_id = p_employee and work_date = p_date;
  perform public.log_action('MANUAL_ATTENDANCE', 'attendance_records', p_employee::text || '@' || p_date, p_reason);
end $$;

create or replace function public.confirm_absence(p_record uuid, p_remarks text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('attendance.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.attendance_records set status = 'absent', absence_confirmed_by = auth.uid(), remarks = p_remarks, is_flagged = false
   where id = p_record and organisation_id = public.current_org_id();
end $$;

-- regularisation request -> approval engine
create or replace function public.request_regularisation(p_date date, p_in time, p_out time, p_type text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_id uuid;
begin
  if v_emp is null then raise exception 'No employee record'; end if;
  if p_date > current_date then raise exception 'Cannot regularise a future date'; end if;
  if exists (select 1 from public.attendance_regularisation where employee_id = v_emp and work_date = p_date and status = 'pending') then
    raise exception 'A request for this date is already pending';
  end if;
  insert into public.attendance_regularisation(organisation_id, employee_id, work_date, requested_in, requested_out, request_type, reason)
  values (public.current_org_id(), v_emp, p_date, p_in, p_out, coalesce(p_type,'missed_punch'), p_reason) returning id into v_id;
  perform public.submit_for_approval('attendance_regularisation', v_id, v_emp,
    'Attendance regularisation · ' || to_char(p_date, 'DD Mon YYYY'), coalesce(p_in::text,'—') || ' to ' || coalesce(p_out::text,'—') || ': ' || p_reason);
  return v_id;
end $$;

create or replace function public.approval_hook_attendance_regularisation(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.attendance_regularisation; v_tz text;
begin
  update public.attendance_regularisation set status = p_status, decided_at = now(), decision_comment = p_comment where id = p_id returning * into r;
  if p_status <> 'approved' then return; end if;
  v_tz := public.org_timezone(r.organisation_id);
  if r.requested_in is not null then
    delete from public.attendance_events where employee_id = r.employee_id and work_date = r.work_date and event_type = 'in' and source <> 'device';
    insert into public.attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status, remarks)
    values (r.organisation_id, r.employee_id, 'in', r.work_date, (r.work_date + r.requested_in) at time zone v_tz, 'manual', 'admin', 'disabled', 'Regularised: ' || r.reason);
  end if;
  if r.requested_out is not null then
    delete from public.attendance_events where employee_id = r.employee_id and work_date = r.work_date and event_type = 'out' and source <> 'device';
    insert into public.attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status, remarks)
    values (r.organisation_id, r.employee_id, 'out', r.work_date,
      (case when r.requested_out < coalesce(r.requested_in, '00:00') then r.work_date + 1 else r.work_date end + r.requested_out) at time zone v_tz,
      'manual', 'admin', 'disabled', 'Regularised: ' || r.reason);
  end if;
  perform public.recompute_attendance_day(r.employee_id, r.work_date);
  update public.attendance_records set is_regularised = true, is_flagged = false, remarks = 'Regularised: ' || r.reason
   where employee_id = r.employee_id and work_date = r.work_date;
end $$;

create or replace function public.request_attendance_permission(p_date date, p_from time, p_to time, p_type text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_id uuid;
begin
  if v_emp is null then raise exception 'No employee record'; end if;
  insert into public.attendance_permissions(organisation_id, employee_id, work_date, from_time, to_time, permission_type, reason)
  values (public.current_org_id(), v_emp, p_date, p_from, p_to, coalesce(p_type,'personal'), p_reason) returning id into v_id;
  perform public.submit_for_approval('attendance_permission', v_id, v_emp,
    'Permission · ' || to_char(p_date, 'DD Mon') || ' ' || to_char(p_from, 'HH24:MI') || '–' || to_char(p_to, 'HH24:MI'), p_reason);
  return v_id;
end $$;

create or replace function public.approval_hook_attendance_permission(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.attendance_permissions;
begin
  update public.attendance_permissions set status = p_status, decided_at = now() where id = p_id returning * into r;
  if p_status = 'approved' then perform public.recompute_attendance_day(r.employee_id, r.work_date); end if;
end $$;

create or replace function public.decide_overtime(p_id uuid, p_approve boolean, p_minutes int default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.overtime_records;
begin
  select * into r from public.overtime_records where id = p_id and organisation_id = public.current_org_id();
  if not found then raise exception 'Not found'; end if;
  if not (public.has_permission('attendance.manage') or (public.has_permission('attendance.view_team') and public.is_subordinate(r.employee_id, public.current_employee_id()))) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if r.payroll_run_id is not null then raise exception 'Overtime already paid in payroll'; end if;
  update public.overtime_records set status = case when p_approve then 'approved' else 'rejected' end,
    approved_minutes = case when p_approve then least(coalesce(p_minutes, minutes), minutes) else 0 end,
    decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

-- CRON: close the day — absent / leave / holiday / weekly-off rows and missing check-out flags
create or replace function public.process_daily_attendance(p_date date default (current_date - 1)) returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int := 0; cs public.company_settings;
begin
  for e in select id, organisation_id, user_id from public.employees
           where status in ('active','probation','notice') and deleted_at is null and date_of_joining <= p_date loop
    perform public.recompute_attendance_day(e.id, p_date);
    select * into cs from public.company_settings where organisation_id = e.organisation_id;
    -- open sessions after the day closes become missing check-outs per policy
    update public.attendance_records set
      status = case cs.missing_checkout_policy when 'half_day' then 'half_day' when 'absent' then 'absent' else 'incomplete' end,
      missing_checkout = true, is_flagged = true
    where employee_id = e.id and work_date = p_date and missing_checkout and not is_regularised;
    if found then
      perform public.notify(e.user_id, 'attendance', 'attendance.missing_checkout',
        jsonb_build_object('title','Missing check-out on ' || to_char(p_date,'DD Mon'), 'date', to_char(p_date,'DD Mon YYYY')), '/me/attendance');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- field location ping: consent + configured tracking window enforced
create or replace function public.record_location_ping(p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_recorded_at timestamptz default now(), p_source text default 'foreground', p_speed double precision default null, p_battery int default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); cs public.company_settings; v_local time;
begin
  if v_emp is null then return false; end if;
  if not public.has_consent(v_emp, 'location') then raise exception 'Location consent not given'; end if;
  select * into cs from public.company_settings where organisation_id = public.current_org_id();
  if cs.gps_mode = 'off' then return false; end if;
  v_local := (coalesce(p_recorded_at, now()) at time zone public.org_timezone(public.current_org_id()))::time;
  if v_local < cs.tracking_start or v_local > cs.tracking_end then return false; end if;   -- outside working window: dropped
  if p_recorded_at > now() + interval '2 minutes' or p_recorded_at < now() - interval '72 hours' then return false; end if;
  insert into public.field_location_records(organisation_id, employee_id, latitude, longitude, accuracy_m, speed_mps, battery_pct, recorded_at, source)
  values (public.current_org_id(), v_emp, p_lat, p_lng, p_accuracy, p_speed, p_battery, p_recorded_at, coalesce(p_source,'foreground'));
  return true;
end $$;

-- device ingestion (called by the biometric-push edge function with the service role only)
create or replace function public.ingest_device_punch(p_device uuid, p_device_user_code text, p_occurred_at timestamptz, p_event_type text, p_client_event_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; d public.attendance_devices;
begin
  select * into d from public.attendance_devices where id = p_device and is_active;
  if not found then raise exception 'Unknown or inactive device'; end if;
  select employee_id into v_emp from public.device_user_mappings where device_id = p_device and device_user_code = p_device_user_code;
  if v_emp is null then raise exception 'Device user % is not mapped to an employee', p_device_user_code; end if;
  update public.attendance_devices set last_seen_at = now() where id = p_device;
  return public._record_attendance_event(v_emp, coalesce(p_event_type,'auto'), 'biometric', 'device', p_occurred_at, d.site_id, null,
    null, null, null, 'disabled', 'dev:' || p_device || ':' || coalesce(p_client_event_id, p_device_user_code || ':' || extract(epoch from p_occurred_at)), null, p_device, null);
end $$;

-- retention purge (cron)
create or replace function public.purge_sensitive_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t int := 0; v_a int := 0; v_l int := 0;
begin
  with x as (
    delete from public.face_templates t using public.employees e, public.company_settings cs
    where e.id = t.employee_id and cs.organisation_id = e.organisation_id and e.status = 'exited'
      and e.exit_date is not null and e.exit_date < current_date - cs.biometric_retention_days returning 1)
  select count(*) into v_t from x;
  with x as (
    delete from public.face_recognition_attempts a using public.company_settings cs
    where cs.organisation_id = a.organisation_id and a.created_at < now() - make_interval(days => cs.recognition_log_retention_days) returning 1)
  select count(*) into v_a from x;
  with x as (
    delete from public.field_location_records f using public.company_settings cs
    where cs.organisation_id = f.organisation_id and f.recorded_at < now() - make_interval(days => cs.location_retention_days) returning 1)
  select count(*) into v_l from x;
  return jsonb_build_object('templates', v_t, 'attempts', v_a, 'locations', v_l);
end $$;

-- ---------- RLS ----------
alter table public.shifts enable row level security;
alter table public.attendance_schedules enable row level security;
alter table public.holidays enable row level security;
alter table public.work_sites enable row level security;
alter table public.employee_site_assignments enable row level security;
alter table public.geofence_settings enable row level security;
alter table public.attendance_devices enable row level security;
alter table public.device_user_mappings enable row level security;
alter table public.data_consents enable row level security;
alter table public.face_enrolments enable row level security;
alter table public.face_templates enable row level security;
alter table public.face_recognition_attempts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_regularisation enable row level security;
alter table public.attendance_permissions enable row level security;
alter table public.overtime_records enable row level security;
alter table public.field_location_records enable row level security;
alter table public.field_visits enable row level security;

do $$
declare t text;
begin
  foreach t in array array['shifts','holidays','work_sites','geofence_settings'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (organisation_id = public.current_org_id())', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (organisation_id = public.current_org_id() and (public.has_permission(''attendance.manage'') or public.has_permission(''field.manage''))) with check (organisation_id = public.current_org_id())', t);
  end loop;
end $$;

create policy sched_read on public.attendance_schedules for select to authenticated using (public.can_view_employee(employee_id, 'attendance'));
create policy sched_write on public.attendance_schedules for all to authenticated
  using (public.has_permission('attendance.manage') and public.can_view_employee(employee_id, 'attendance'))
  with check (public.has_permission('attendance.manage'));

create policy esa_read on public.employee_site_assignments for select to authenticated using (public.can_view_employee(employee_id, 'field') or employee_id = public.current_employee_id());
create policy esa_write on public.employee_site_assignments for all to authenticated using (public.has_permission('field.manage')) with check (public.has_permission('field.manage'));

create policy dev_read on public.attendance_devices for select to authenticated using (organisation_id = public.current_org_id() and public.has_permission('attendance.devices'));
create policy dev_write on public.attendance_devices for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('attendance.devices')) with check (organisation_id = public.current_org_id());
create policy dum_rw on public.device_user_mappings for all to authenticated
  using (public.has_permission('attendance.devices')) with check (public.has_permission('attendance.devices'));

create policy consent_read on public.data_consents for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_permission('attendance.face_enrol'));

create policy enrol_read on public.face_enrolments for select to authenticated
  using (employee_id = public.current_employee_id() or (public.has_permission('attendance.face_enrol') and public.can_view_employee(employee_id, 'attendance')));
-- face_templates: RLS enabled with NO policies => no client access at all
create policy fra_read on public.face_recognition_attempts for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('attendance.face_enrol')));

create policy ev_read on public.attendance_events for select to authenticated using (public.can_view_employee(employee_id, 'attendance'));
create policy rec_read on public.attendance_records for select to authenticated using (public.can_view_employee(employee_id, 'attendance'));
create policy rec_update on public.attendance_records for update to authenticated
  using (public.has_permission('attendance.manage') and organisation_id = public.current_org_id()) with check (organisation_id = public.current_org_id());

create policy reg_read on public.attendance_regularisation for select to authenticated using (public.can_view_employee(employee_id, 'attendance'));
create policy perm_read on public.attendance_permissions for select to authenticated using (public.can_view_employee(employee_id, 'attendance'));
create policy ot_read on public.overtime_records for select to authenticated using (public.can_view_employee(employee_id, 'attendance'));

create policy flr_read on public.field_location_records for select to authenticated
  using (employee_id = public.current_employee_id() or (public.has_permission('field.view') and public.can_view_employee(employee_id, 'field')));
create policy fv_read on public.field_visits for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_view_employee(employee_id, 'field'));
create policy fv_insert on public.field_visits for insert to authenticated
  with check (employee_id = public.current_employee_id() and organisation_id = public.current_org_id());
create policy fv_update on public.field_visits for update to authenticated
  using (employee_id = public.current_employee_id()) with check (employee_id = public.current_employee_id());
