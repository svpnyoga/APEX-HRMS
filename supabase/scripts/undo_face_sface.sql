-- UNDO the SFace face-model switch (migration 20261126000300_face_model_sface.sql).
-- Run this ONLY if you already ran that migration. Safe to run once; puts everything back as it was.
-- Afterwards everyone's old face enrolment works again (anyone who re-enrolled with SFace gets their
-- previous enrolment back).

-- 1. old scoring and the old model as the company setting
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

alter table public.company_settings alter column face_provider set default 'human-faceres-v1';
update public.company_settings set face_provider = 'human-faceres-v1';

-- 2. switch off SFace samples; switch the most recent old-model enrolment of each employee back on
update public.face_templates set is_active = false where model <> 'human-faceres-v1' and is_active;
update public.face_templates t set is_active = true
  from (select employee_id, max(created_at) last_at from public.face_templates where model = 'human-faceres-v1' group by employee_id) l
 where t.employee_id = l.employee_id and t.model = 'human-faceres-v1' and t.created_at = l.last_at;
update public.face_enrolments en set status = 'enrolled', model = 'human-faceres-v1',
       samples_count = (select count(*) from public.face_templates t where t.employee_id = en.employee_id and t.is_active), updated_at = now()
 where exists (select 1 from public.face_templates t where t.employee_id = en.employee_id and t.is_active and t.model = 'human-faceres-v1');
update public.face_enrolments en set status = 'not_enrolled', samples_count = 0, updated_at = now()
 where not exists (select 1 from public.face_templates t where t.employee_id = en.employee_id and t.is_active);

-- 3. previous versions of the functions
create or replace function public._face_store(p_employee uuid, p_model text, p_embeddings jsonb, p_qualities jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_min int; i int; v_q numeric; v_qsum numeric := 0; v_org uuid;
begin
  select organisation_id into v_org from public.employees where id = p_employee;
  if not public.has_consent(p_employee, 'biometric') then raise exception 'Biometric consent is needed before face enrolment'; end if;
  select face_min_samples into v_min from public.company_settings where organisation_id = v_org;
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
      when en.enrolled_at is null then 'first_enrolment'                       -- never enrolled: may enrol once
      when r.status = 'approved' then 'reenrol_approved'
      when r.status = 'pending' then 'reenrol_pending'
      when en.status = 'enrolled' then 'enrolled'
      else 'revoked' end,
    'enrolment_status', coalesce(en.status, 'not_enrolled'), 'enrolled_at', en.enrolled_at, 'samples', en.samples_count,
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
  if en.enrolled_at is not null then
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
