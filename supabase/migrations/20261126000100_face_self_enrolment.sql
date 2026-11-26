-- Face self-enrolment
--  • An employee can enrol their own face ONCE (first enrolment — HR is present in person).
--  • After that, re-enrolling needs a request that HR approves; an approval is good for one re-enrolment.
--  • HR can still enrol / revoke anyone directly (face_enrol, face_revoke_enrolment).
--  • HR is notified of every self-enrolment and every request; the employee is told HR's decision.

create table if not exists public.face_reenrol_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','used','cancelled')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text,
  used_at timestamptz
);
create index if not exists face_reenrol_requests_emp on public.face_reenrol_requests(employee_id, status);
-- at most one open (pending or approved-but-unused) request per employee
create unique index if not exists face_reenrol_one_open on public.face_reenrol_requests(employee_id) where status in ('pending','approved');

alter table public.face_reenrol_requests enable row level security;
drop policy if exists frr_read on public.face_reenrol_requests;
create policy frr_read on public.face_reenrol_requests for select to authenticated
  using (organisation_id = public.current_org_id()
         and (employee_id = public.current_employee_id() or public.has_permission('attendance.face_enrol')));
-- no insert/update/delete policies: changes only through the functions below

insert into public.notification_templates(organisation_id, code, title_template, body_template, send_email)
select * from (values
  (null::uuid, 'face.self_enrolled', '{{name}} enrolled their face', '{{name}} completed face enrolment on their own device ({{samples}} samples).', false),
  (null::uuid, 'face.reenrol_requested', 'Face re-enrolment request: {{name}}', '{{name}} asked to re-enrol their face. Reason: {{reason}}. Review it in Attendance › Face recognition.', true),
  (null::uuid, 'face.reenrol_decided', 'Face re-enrolment {{status}}', 'Your request to re-enrol your face was {{status}}. {{comment}}', true)
) v(organisation_id, code, title_template, body_template, send_email)
where not exists (select 1 from public.notification_templates t where t.organisation_id is null and t.code = v.code);

-- shared storage of samples (no permission check: only called by the functions below)
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

-- HR enrolment (unchanged behaviour); also closes any approved request, since HR has just re-enrolled them
create or replace function public.face_enrol(p_employee uuid, p_model text, p_embeddings jsonb, p_qualities jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.has_permission('attendance.face_enrol') then raise exception 'Only HR/admin can enrol faces' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where id = p_employee and organisation_id = public.current_org_id()) then raise exception 'Employee not found'; end if;
  v_n := public._face_store(p_employee, p_model, p_embeddings, p_qualities);
  update public.face_reenrol_requests set status = 'used', used_at = now() where employee_id = p_employee and status = 'approved';
  perform public.log_action('FACE_ENROL', 'face_templates', p_employee::text, format('%s samples, model %s', v_n, p_model));
  return jsonb_build_object('samples', v_n);
end $$;

-- what the employee may do right now
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

-- the employee enrols their own face: first time freely, afterwards only with an approved request (used once)
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

create or replace function public.request_face_reenrol(p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); e public.employees; v_id uuid; hr record;
begin
  if v_emp is null then raise exception 'Your login is not linked to an employee record'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please give a reason'; end if;
  if not exists (select 1 from public.face_enrolments where employee_id = v_emp and enrolled_at is not null) then
    raise exception 'You have not enrolled yet — you can enrol directly the first time';
  end if;
  if exists (select 1 from public.face_reenrol_requests where employee_id = v_emp and status in ('pending','approved')) then
    raise exception 'You already have an open re-enrolment request';
  end if;
  select * into e from public.employees where id = v_emp;
  insert into public.face_reenrol_requests(organisation_id, employee_id, reason, requested_by)
  values (e.organisation_id, v_emp, trim(p_reason), auth.uid()) returning id into v_id;
  for hr in select distinct ur.user_id from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
             join public.user_profiles up on up.id = ur.user_id
            where up.organisation_id = e.organisation_id and up.is_active and rp.permission_code in ('attendance.face_enrol', '*') loop
    perform public.notify(hr.user_id, 'attendance', 'face.reenrol_requested',
      jsonb_build_object('name', trim(e.first_name || ' ' || coalesce(e.last_name, '')), 'reason', trim(p_reason)), '/attendance/face', 'face_reenrol_request', v_id);
  end loop;
  return v_id;
end $$;

create or replace function public.cancel_face_reenrol() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.face_reenrol_requests set status = 'cancelled'
   where employee_id = public.current_employee_id() and status in ('pending','approved');
end $$;

create or replace function public.decide_face_reenrol(p_request uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.face_reenrol_requests; v_user uuid;
begin
  if not public.has_permission('attendance.face_enrol') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.face_reenrol_requests where id = p_request and organisation_id = public.current_org_id() for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request has already been %', r.status; end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then raise exception 'Please give a reason for rejecting'; end if;
  update public.face_reenrol_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_comment = nullif(trim(coalesce(p_comment, '')), '')
   where id = p_request;
  perform public.log_action(case when p_approve then 'FACE_REENROL_APPROVE' else 'FACE_REENROL_REJECT' end, 'face_reenrol_requests', p_request::text, p_comment);
  select user_id into v_user from public.employees where id = r.employee_id;
  perform public.notify(v_user, 'attendance', 'face.reenrol_decided',
    jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end,
                       'comment', case when p_approve then 'You can now enrol again from Profile › Face attendance.' else coalesce(p_comment, '') end),
    '/me/profile', 'face_reenrol_request', p_request);
end $$;

grant execute on function public.face_self_status(), public.face_self_enrol(text, jsonb, jsonb), public.request_face_reenrol(text),
  public.cancel_face_reenrol(), public.decide_face_reenrol(uuid, boolean, text) to authenticated;
