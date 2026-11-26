-- Faster face clock-in — four HR switches (Admin › Attendance settings):
--  face_preload_models          load the face models as soon as the app opens            (default ON)
--  face_single_challenge        one random challenge (blink OR turn) instead of both      (default ON)
--  face_easy_turn               smaller head turn, one side only                          (default ON)
--  face_skip_challenge_in_office no blink/turn when the server confirms the phone is inside
--                               an office site's radius with good GPS, online only        (default OFF)
-- Turning a switch off restores the previous behaviour immediately.
-- UNDO: alter table company_settings drop column face_preload_models, drop column face_single_challenge,
--       drop column face_easy_turn, drop column face_skip_challenge_in_office;  then re-run the original
--       face_clock (20261105000400) and my_home (20261105001000) definitions.

alter table public.company_settings
  add column if not exists face_preload_models boolean not null default true,
  add column if not exists face_single_challenge boolean not null default true,
  add column if not exists face_easy_turn boolean not null default true,
  add column if not exists face_skip_challenge_in_office boolean not null default false;

-- is this live punch inside an office site (chosen site if it is an office, else the employee's primary/office site)?
create or replace function public._face_in_office(p_emp uuid, p_site uuid, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_gps_status text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e public.employees; cs public.company_settings; gs public.geofence_settings; s public.work_sites; v_dist double precision;
begin
  select * into e from public.employees where id = p_emp;
  select * into cs from public.company_settings where organisation_id = e.organisation_id;
  if not coalesce(cs.face_skip_challenge_in_office, false) then return false; end if;
  if p_lat is null or p_lng is null or coalesce(p_gps_status, '') <> 'ok' then return false; end if;
  select * into gs from public.geofence_settings where organisation_id = e.organisation_id and site_id is null limit 1;
  if coalesce(p_accuracy, 1e9) > coalesce(gs.require_accuracy_m, 150) then return false; end if;
  if p_site is not null then
    select * into s from public.work_sites where id = p_site and organisation_id = e.organisation_id;
  else
    select ws.* into s from public.employee_site_assignments a join public.work_sites ws on ws.id = a.site_id
     where a.employee_id = p_emp and a.is_primary and ws.is_active and (a.valid_to is null or a.valid_to >= current_date)
     order by a.valid_from desc limit 1;
    if s.id is null then
      select * into s from public.work_sites where organisation_id = e.organisation_id and site_type = 'office' and is_active and is_approved order by created_at limit 1;
    end if;
  end if;
  if s.id is null or s.site_type <> 'office' or s.latitude is null or not s.is_active then return false; end if;
  v_dist := public.geo_distance_m(p_lat, p_lng, s.latitude, s.longitude);
  return v_dist <= s.radius_m;
end $$;
revoke all on function public._face_in_office(uuid, uuid, double precision, double precision, double precision, text) from public, anon, authenticated;

create or replace function public.face_clock(
  p_embedding text, p_model text, p_antispoof numeric, p_liveness numeric, p_challenge_passed boolean, p_quality numeric,
  p_event_type text default 'auto', p_site_id uuid default null, p_new_site_name text default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_gps_status text default null, p_client_event_id text default null, p_occurred_at timestamptz default null, p_offline boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_eval jsonb; v_event jsonb; v_skipped boolean := false;
begin
  if v_emp is null then raise exception 'Your login is not linked to an employee record'; end if;
  if not public.has_permission('attendance.clock') then raise exception 'Not authorised to record attendance' using errcode = '42501'; end if;
  -- idempotent replay of an already-synced offline punch
  if p_client_event_id is not null and exists (select 1 from public.attendance_events where employee_id = v_emp and client_event_id = p_client_event_id) then
    return jsonb_build_object('outcome','matched','duplicate',true);
  end if;
  -- HR switch: the blink/turn step may be skipped for a live punch that the SERVER confirms is inside an office site
  if not coalesce(p_challenge_passed, false) and not coalesce(p_offline, false)
     and public._face_in_office(v_emp, p_site_id, p_lat, p_lng, p_accuracy, p_gps_status) then
    v_skipped := true;
  end if;
  v_eval := public._face_evaluate(v_emp, p_embedding::vector, p_model, p_antispoof, p_liveness, p_challenge_passed or v_skipped, p_quality, 'verify', null);
  if v_skipped then   -- keep the log honest: the challenge was not done
    update public.face_recognition_attempts set challenge_passed = false,
      reason = coalesce(reason || ' · ', '') || 'blink/turn skipped (inside office)' where id = (v_eval->>'attempt_id')::uuid;
  end if;
  if v_eval->>'outcome' <> 'matched' then return v_eval; end if;
  v_event := public._record_attendance_event(v_emp, p_event_type, 'face', case when p_offline then 'offline_sync' else 'online' end,
     p_occurred_at, p_site_id, p_new_site_name, p_lat, p_lng, p_accuracy, p_gps_status, p_client_event_id,
     (v_eval->>'attempt_id')::uuid, null, null);
  return v_eval || v_event;
end $$;

create or replace function public.my_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_org uuid := public.current_org_id(); v_year int;
begin
  if v_emp is null then return null; end if;
  v_year := public.leave_year_of(v_org, current_date);
  return jsonb_build_object(
    'today', (select row_to_json(r) from public.attendance_records r where employee_id = v_emp and work_date = (now() at time zone public.org_timezone(v_org))::date),
    'open_session', (select row_to_json(x) from (select event_type, occurred_at, site_id from public.attendance_events where employee_id = v_emp order by occurred_at desc limit 1) x),
    'shift', (select row_to_json(s) from public.employee_shift(v_emp, current_date) s),
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('leave_type_id', lt.id, 'name', lt.name, 'code', lt.code, 'color', lt.color,
                    'balance', coalesce(lb.balance, 0), 'available', public.leave_available(v_emp, lt.id, v_year), 'used', coalesce(lb.used,0),
                    'accrues', exists (select 1 from public.leave_policies lp where lp.leave_type_id = lt.id and lp.is_active and lp.accrual_frequency <> 'none')) order by lt.name), '[]')
                 from public.leave_types lt left join public.leave_balances lb on lb.leave_type_id = lt.id and lb.employee_id = v_emp and lb.leave_year = v_year
                 join public.employees me on me.id = v_emp
                 where lt.organisation_id = v_org and lt.is_active and lt.requires_balance
                   and (lt.gender_restriction is null or lt.gender_restriction = me.gender)),
    'latest_payslip', (select row_to_json(x) from (select ps.id, ps.period_month, pe.net_pay, pe.gross_earnings from public.payslips ps join public.payroll_entries pe on pe.id = ps.entry_id
                        where ps.employee_id = v_emp order by ps.period_month desc limit 1) x),
    'claims', (select jsonb_build_object('pending', count(*) filter (where status = 'submitted'), 'approved', count(*) filter (where status = 'approved'),
                 'pending_amount', coalesce(sum(amount) filter (where status in ('submitted','approved')), 0)) from public.expense_claims where employee_id = v_emp),
    'pending_tasks', (select count(*) from public.approval_tasks where approver_user_id = auth.uid() and status = 'pending')
                   + (select count(*) from public.onboarding_tasks t join public.onboarding_cases c on c.id = t.case_id where c.employee_id = v_emp and t.owner_role = 'employee' and t.status = 'pending')
                   + (select count(*) from public.appraisal_reviews where employee_id = v_emp and stage = 'self' and status = 'pending'),
    'learning', (select jsonb_build_object('enrolled', count(*), 'completed', count(*) filter (where status = 'completed'), 'avg_progress', coalesce(round(avg(progress)),0),
                   'due_soon', count(*) filter (where status not in ('completed','withdrawn') and due_date <= current_date + 7)) from public.course_enrolments where employee_id = v_emp),
    'holidays', (select coalesce(jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name, 'type', holiday_type) order by holiday_date), '[]') from (
                   select * from public.holidays where organisation_id = v_org and holiday_date >= current_date order by holiday_date limit 5) h),
    'face', (select jsonb_build_object('status', coalesce((select status from public.face_enrolments where employee_id = v_emp), 'not_enrolled'),
                                        'consent', public.has_consent(v_emp, 'biometric'), 'location_consent', public.has_consent(v_emp, 'location'))),
    'settings', (select jsonb_build_object('face_required', cs.face_recognition_enabled and cs.face_required_for_clock, 'face_enabled', cs.face_recognition_enabled,
                    'gps_mode', cs.gps_mode, 'allow_new_site', cs.allow_new_site_entry, 'match_threshold', cs.face_match_threshold,
                    'antispoof_threshold', cs.face_antispoof_threshold, 'liveness_threshold', cs.face_liveness_threshold, 'face_provider', cs.face_provider,
                    'min_samples', cs.face_min_samples, 'face_preload', cs.face_preload_models, 'face_single_challenge', cs.face_single_challenge,
                    'face_easy_turn', cs.face_easy_turn, 'face_skip_in_office', cs.face_skip_challenge_in_office)
                 from public.company_settings cs where cs.organisation_id = v_org),
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'latitude', s.latitude, 'longitude', s.longitude, 'radius_m', s.radius_m, 'site_type', s.site_type,
                 'assigned', exists (select 1 from public.employee_site_assignments a where a.site_id = s.id and a.employee_id = v_emp and (a.valid_to is null or a.valid_to >= current_date)),
                 'primary', exists (select 1 from public.employee_site_assignments a where a.site_id = s.id and a.employee_id = v_emp and a.is_primary)) order by s.name), '[]')
              from public.work_sites s where s.organisation_id = v_org and s.is_active and s.is_approved)
  );
end $$;
