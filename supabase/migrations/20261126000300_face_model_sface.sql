-- Face matching: switch to a real face-recognition model (SFace) and reject look-alikes
--
-- Why: the old descriptor (Human "faceres") is not built for telling people apart. Its score hits 1.0 for
-- many faces, so at 0.60 a colleague clocked in as Malathi (0.826) while Kumaran's real face scored 0.759.
-- On a labelled test set, SFace (OpenCV Zoo, Apache-2.0, MobileFaceNet trained for face verification)
-- kept every different-person pair below cosine 0.36, while same-person pairs had a median of 0.56-0.59.
--
-- 1. face_similarity('sface…'): cosine mapped to 0-1 as (cos - 0.15) / 0.40, so the existing 0.60 threshold
--    means cosine 0.39 (just above OpenCV's own 0.363 cut-off). Nothing saturates in the look-alike range.
-- 2. The company's model becomes 'sface-2021dec-v1'. Old-model templates are switched off: everyone enrols
--    once more. Old-model enrolments count as "not enrolled", so employees can self-enrol again without a
--    re-enrolment request (HR should be present, as with a first enrolment).
-- 3. A check-in, kiosk or HR test sent by an old cached copy of the app (old model) is refused with
--    "refresh the app", so the weak model can never be used again.
-- 4. Look-alike check: a clock-in is rejected if the face fits ANY other current employee at least as well
--    (within 0.05) as the person clocking in.
--
-- UNDO (back to the old model): update public.company_settings set face_provider = 'human-faceres-v1';
--   update public.face_templates set is_active = true where model = 'human-faceres-v1'
--     and employee_id not in (select employee_id from public.face_templates where model <> 'human-faceres-v1' and is_active);
--   (and redeploy the previous app version)

create or replace function public.face_similarity(p_model text, a vector, b vector) returns double precision
language plpgsql immutable as $$
begin
  if vector_dims(a) <> vector_dims(b) then return 0; end if;
  if p_model like 'sface%' then
    return greatest(0, least(1, ((1 - (a <=> b)) - 0.15) / 0.40));
  elsif p_model like 'human-faceres%' then
    return greatest(0, least(1, (0.8 - (a <-> b) / 20.0) / 0.6));
  else
    return greatest(0, least(1, 1 - (a <=> b)));
  end if;
end $$;

alter table public.company_settings alter column face_provider set default 'sface-2021dec-v1';
update public.company_settings set face_provider = 'sface-2021dec-v1' where face_provider = 'human-faceres-v1';

update public.face_templates t set is_active = false
  from public.employees e join public.company_settings cs on cs.organisation_id = e.organisation_id
 where e.id = t.employee_id and t.is_active and t.model is distinct from cs.face_provider;
update public.face_enrolments en set status = 'not_enrolled', samples_count = 0, updated_at = now()
  from public.employees e join public.company_settings cs on cs.organisation_id = e.organisation_id
 where e.id = en.employee_id and en.status = 'enrolled' and en.model is distinct from cs.face_provider;

create or replace function public._face_store(p_employee uuid, p_model text, p_embeddings jsonb, p_qualities jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_min int; i int; v_q numeric; v_qsum numeric := 0; v_org uuid;
begin
  select organisation_id into v_org from public.employees where id = p_employee;
  if not public.has_consent(p_employee, 'biometric') then raise exception 'Biometric consent is needed before face enrolment'; end if;
  select face_min_samples into v_min from public.company_settings where organisation_id = v_org;
  if p_model is distinct from (select face_provider from public.company_settings where organisation_id = v_org) then
    raise exception 'This app version uses an old face model. Please refresh the app and try again.';
  end if;
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
  return v_n;
end $$;
revoke all on function public._face_store(uuid, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public._face_evaluate(
  p_emp uuid, p_embedding vector, p_model text, p_antispoof numeric, p_liveness numeric, p_challenge boolean, p_quality numeric, p_mode text, p_device uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid; cs public.company_settings; v_sim double precision; v_recent int; v_outcome text; v_reason text; v_attempt uuid; v_other double precision;
begin
  select organisation_id into v_org from public.employees where id = p_emp;
  select * into cs from public.company_settings where organisation_id = v_org;
  select count(*) into v_recent from public.face_recognition_attempts
   where employee_id = p_emp and created_at > now() - interval '1 hour' and outcome <> 'matched';
  if v_recent >= cs.face_max_attempts_per_hour then
    v_outcome := 'rate_limited'; v_reason := 'Too many failed attempts in the last hour';
  elsif p_model is distinct from cs.face_provider then
    v_outcome := 'not_enrolled'; v_reason := 'Old face model - refresh the app';
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
    -- the same score against every OTHER current employee: if someone else fits better, it is not this person
    select max(s3) into v_other from (
      select avg(s) filter (where rn <= 3) s3 from (
        select t.employee_id, public.face_similarity(p_model, t.embedding, p_embedding) s,
               row_number() over (partition by t.employee_id order by public.face_similarity(p_model, t.embedding, p_embedding) desc) rn
        from public.face_templates t join public.employees e on e.id = t.employee_id
        where e.organisation_id = v_org and t.employee_id <> p_emp and e.status not in ('exited','inactive') and t.model = p_model and t.is_active) y
      group by employee_id) z;
    if v_sim < cs.face_match_threshold then v_outcome := 'no_match'; v_reason := 'Face did not match enrolled templates';
    elsif v_other is not null and v_other >= v_sim - 0.05 then v_outcome := 'no_match'; v_reason := 'Face is closer to another employee';
    else v_outcome := 'matched'; end if;
  end if;
  v_attempt := public._face_log(v_org, p_emp, p_mode, p_model, v_sim, p_antispoof, p_liveness, p_challenge, p_quality, v_outcome, v_reason, p_device);
  return jsonb_build_object('attempt_id', v_attempt, 'outcome', v_outcome, 'similarity', round(coalesce(v_sim,0)::numeric, 3),
                            'threshold', cs.face_match_threshold, 'reason', v_reason);
end $$;
revoke all on function public._face_evaluate(uuid, vector, text, numeric, numeric, boolean, numeric, text, uuid) from public, anon, authenticated;

create or replace function public.face_self_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); en public.face_enrolments; r public.face_reenrol_requests; cs public.company_settings;
begin
  if v_emp is null then return jsonb_build_object('state', 'no_employee'); end if;
  select * into cs from public.company_settings where organisation_id = public.current_org_id();
  if not coalesce(cs.face_recognition_enabled, false) then return jsonb_build_object('state', 'disabled'); end if;
  select * into en from public.face_enrolments where employee_id = v_emp;
  select * into r from public.face_reenrol_requests where employee_id = v_emp order by requested_at desc limit 1;
  return jsonb_build_object(
    'state', case
      when en.enrolled_at is null or en.model is distinct from cs.face_provider then 'first_enrolment'                       -- never enrolled: may enrol once
      when r.status = 'approved' then 'reenrol_approved'
      when r.status = 'pending' then 'reenrol_pending'
      when en.status = 'enrolled' then 'enrolled'
      else 'revoked' end,
    'enrolment_status', case when en.model is distinct from cs.face_provider then 'not_enrolled' else coalesce(en.status, 'not_enrolled') end, 'enrolled_at', en.enrolled_at, 'samples', en.samples_count,
    'consent', public.has_consent(v_emp, 'biometric'),
    'last_request', case when r.id is null then null else jsonb_build_object('status', r.status, 'reason', r.reason,
       'requested_at', r.requested_at, 'decided_at', r.decided_at, 'comment', r.decision_comment) end);
end $$;

create or replace function public.face_self_enrol(p_model text, p_embeddings jsonb, p_qualities jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); en public.face_enrolments; v_req uuid; v_n int; e public.employees; cs public.company_settings; hr record;
begin
  if v_emp is null then raise exception 'Your login is not linked to an employee record'; end if;
  select * into e from public.employees where id = v_emp;
  if e.status in ('exited','inactive') then raise exception 'Employee is not active'; end if;
  select * into cs from public.company_settings where organisation_id = e.organisation_id;
  if not coalesce(cs.face_recognition_enabled, false) then raise exception 'Face attendance is not enabled'; end if;
  select * into en from public.face_enrolments where employee_id = v_emp for update;
  if en.enrolled_at is not null and en.model is not distinct from cs.face_provider then   -- an old-model enrolment counts as none
    select id into v_req from public.face_reenrol_requests where employee_id = v_emp and status = 'approved' for update;
    if v_req is null then
      raise exception 'You have already enrolled your face. To enrol again, send a re-enrolment request to HR.' using errcode = '42501';
    end if;
  end if;
  v_n := public._face_store(v_emp, p_model, p_embeddings, p_qualities);
  if v_req is not null then update public.face_reenrol_requests set status = 'used', used_at = now() where id = v_req; end if;
  perform public.log_action(case when v_req is null then 'FACE_SELF_ENROL' else 'FACE_SELF_REENROL' end, 'face_templates', v_emp::text,
                            format('%s samples, model %s', v_n, p_model));
  for hr in select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
             join public.user_profiles up on up.id = ur.user_id
            where up.organisation_id = e.organisation_id and up.is_active and rp.permission_code in ('attendance.face_enrol', '*') loop
    perform public.notify(hr.user_id, 'attendance', 'face.self_enrolled',
      jsonb_build_object('name', trim(e.first_name || ' ' || coalesce(e.last_name, '')), 'samples', v_n), '/attendance/face', 'employee', v_emp);
  end loop;
  return jsonb_build_object('samples', v_n, 'reenrolment', v_req is not null);
end $$;
