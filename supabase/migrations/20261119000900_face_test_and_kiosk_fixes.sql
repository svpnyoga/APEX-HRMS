-- Face recognition fixes
-- 1. HR "Test" now scores exactly like real check-in (mean of the best 3 samples, not the single best),
--    so threshold calibration is trustworthy.
-- 2. Kiosk look-alike check ignores exited/inactive employees, so a former employee can't block a current one.

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
    where e.organisation_id = v_org and e.status not in ('exited','inactive') and t.model = p_model and t.is_active
      and t.employee_id <> v_best group by t.employee_id) y;
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

create or replace function public.face_test_match(p_employee uuid, p_embedding text, p_model text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sim double precision;
begin
  if not public.has_permission('attendance.face_enrol') then raise exception 'Not authorised' using errcode = '42501'; end if;
  -- same score as real check-in (_face_evaluate): mean of the top-3 sample similarities
  select avg(s) filter (where rn <= 3) into v_sim
  from (select public.face_similarity(p_model, t.embedding, p_embedding::vector) s,
               row_number() over (order by public.face_similarity(p_model, t.embedding, p_embedding::vector) desc) rn
        from public.face_templates t join public.employees e on e.id = t.employee_id
        where t.employee_id = p_employee and e.organisation_id = public.current_org_id() and t.model = p_model and t.is_active) x;
  perform public._face_log(public.current_org_id(), p_employee, 'enrol_test', p_model, v_sim, null, null, null, null,
     case when v_sim is null then 'not_enrolled' when v_sim >= (select face_match_threshold from public.company_settings where organisation_id = public.current_org_id()) then 'matched' else 'no_match' end,
     'HR test', null);
  return jsonb_build_object('similarity', round(coalesce(v_sim,0)::numeric,3));
end $$;
