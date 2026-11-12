-- =====================================================================
-- 0009 ONBOARDING, OFFBOARDING, LEARNING (LMS)
-- =====================================================================
create table public.onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  kind text not null check (kind in ('onboarding','offboarding')),
  title text not null,
  category text not null check (category in ('information','documents','verification','assignment','account','asset','policy','approval',
                                             'handover','clearance','asset_return','settlement','interview','access')),
  owner_role text not null default 'hr' check (owner_role in ('hr','manager','employee','it','finance','admin')),
  sort_order int not null default 0,
  due_offset_days int not null default 0,
  is_mandatory boolean not null default true,
  is_active boolean not null default true
);

create table public.onboarding_cases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  joining_date date not null,
  buddy_employee_id uuid references public.employees(id),
  status text not null default 'in_progress' check (status in ('in_progress','pending_approval','completed','cancelled')),
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.onboarding_cases(id) on delete cascade,
  title text not null,
  category text not null,
  owner_role text not null,
  sort_order int not null default 0,
  due_date date,
  is_mandatory boolean not null default true,
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  completed_by uuid,
  completed_at timestamptz,
  notes text
);
create index on public.onboarding_tasks(case_id, sort_order);

create table public.policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (employee_id, announcement_id)
);

create table public.offboarding_cases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  separation_type text not null default 'resignation' check (separation_type in ('resignation','termination','retirement','contract_end','absconding')),
  resignation_date date not null default current_date,
  reason text not null,
  requested_lwd date not null,
  approved_lwd date,
  notice_waived boolean not null default false,
  status text not null default 'pending_approval' check (status in ('pending_approval','approved','rejected','withdrawn','in_clearance','completed')),
  exit_completed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index offboarding_one_active on public.offboarding_cases(employee_id) where status in ('pending_approval','approved','in_clearance');

create table public.offboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.offboarding_cases(id) on delete cascade,
  title text not null,
  category text not null,
  owner_role text not null,
  sort_order int not null default 0,
  due_date date,
  is_mandatory boolean not null default true,
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  completed_by uuid,
  completed_at timestamptz,
  notes text
);

create table public.clearance_records (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.offboarding_cases(id) on delete cascade,
  department text not null check (department in ('reporting_manager','it','finance','admin','hr','stores')),
  status text not null default 'pending' check (status in ('pending','cleared','dues_pending')),
  dues_amount numeric(12,2) not null default 0,
  remarks text,
  cleared_by uuid,
  cleared_at timestamptz,
  unique (case_id, department)
);

create table public.exit_interviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.offboarding_cases(id) on delete cascade,
  primary_reason text,
  would_rejoin boolean,
  would_recommend boolean,
  rating_role int check (rating_role between 1 and 5),
  rating_manager int check (rating_manager between 1 and 5),
  rating_culture int check (rating_culture between 1 and 5),
  rating_growth int check (rating_growth between 1 and 5),
  liked_most text,
  improve text,
  conducted_by uuid,
  conducted_at timestamptz not null default now()
);

-- ---------- onboarding functions ----------
create or replace function public.start_onboarding(p_employee uuid, p_buddy uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.employees; v_case uuid;
begin
  if not public.has_permission('onboarding.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee and organisation_id = public.current_org_id();
  if not found then raise exception 'Employee not found'; end if;
  insert into public.onboarding_cases(organisation_id, employee_id, joining_date, buddy_employee_id, created_by)
  values (e.organisation_id, e.id, e.date_of_joining, p_buddy, auth.uid()) returning id into v_case;
  insert into public.onboarding_tasks(case_id, title, category, owner_role, sort_order, due_date, is_mandatory)
  select v_case, t.title, t.category, t.owner_role, t.sort_order, e.date_of_joining + t.due_offset_days, t.is_mandatory
  from public.onboarding_templates t where t.organisation_id = e.organisation_id and t.kind = 'onboarding' and t.is_active order by t.sort_order;
  update public.employees set status = 'onboarding' where id = e.id and status in ('active','probation');
  insert into public.employee_employment_history(employee_id, event_type, effective_date, to_department_id, to_designation_id, to_manager_id, remarks, created_by)
  values (e.id, 'joined', e.date_of_joining, e.department_id, e.designation_id, e.reporting_manager_id, 'Onboarding started', auth.uid());
  return v_case;
end $$;

create or replace function public.complete_lifecycle_task(p_kind text, p_task uuid, p_status text, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_owner text;
begin
  if p_status not in ('done','skipped','pending') then raise exception 'Invalid status'; end if;
  if p_kind = 'onboarding' then
    select c.employee_id, t.owner_role into v_emp, v_owner from public.onboarding_tasks t join public.onboarding_cases c on c.id = t.case_id
     where t.id = p_task and c.organisation_id = public.current_org_id();
    if not (public.has_permission('onboarding.manage') or (v_owner = 'employee' and v_emp = public.current_employee_id())
            or (v_owner = 'manager' and public.is_subordinate(v_emp, public.current_employee_id()))) then
      raise exception 'Not authorised' using errcode = '42501';
    end if;
    update public.onboarding_tasks set status = p_status, notes = coalesce(p_notes, notes),
      completed_by = case when p_status = 'pending' then null else auth.uid() end, completed_at = case when p_status = 'pending' then null else now() end
    where id = p_task;
  else
    select c.employee_id, t.owner_role into v_emp, v_owner from public.offboarding_tasks t join public.offboarding_cases c on c.id = t.case_id
     where t.id = p_task and c.organisation_id = public.current_org_id();
    if not (public.has_permission('offboarding.manage') or (v_owner = 'employee' and v_emp = public.current_employee_id())
            or (v_owner = 'manager' and public.is_subordinate(v_emp, public.current_employee_id()))) then
      raise exception 'Not authorised' using errcode = '42501';
    end if;
    update public.offboarding_tasks set status = p_status, notes = coalesce(p_notes, notes),
      completed_by = case when p_status = 'pending' then null else auth.uid() end, completed_at = case when p_status = 'pending' then null else now() end
    where id = p_task;
  end if;
end $$;

-- HR sign-off goes through the approval engine
create or replace function public.submit_onboarding_completion(p_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.onboarding_cases;
begin
  if not public.has_permission('onboarding.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into c from public.onboarding_cases where id = p_case and organisation_id = public.current_org_id();
  if exists (select 1 from public.onboarding_tasks where case_id = p_case and is_mandatory and status = 'pending' and category <> 'approval') then
    raise exception 'Complete all mandatory tasks first';
  end if;
  update public.onboarding_cases set status = 'pending_approval' where id = p_case;
  perform public.submit_for_approval('onboarding', p_case, c.employee_id, 'Onboarding completion · ' || public.employee_name(c.employee_id), null);
end $$;

create or replace function public.approval_hook_onboarding(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.onboarding_cases;
begin
  if p_status = 'approved' then
    update public.onboarding_cases set status = 'completed', completed_at = now() where id = p_id returning * into c;
    update public.onboarding_tasks set status = 'done', completed_at = now() where case_id = p_id and category = 'approval' and status = 'pending';
    update public.employees set status = case when probation_end_date is not null and probation_end_date > current_date then 'probation' else 'active' end
     where id = c.employee_id and status = 'onboarding';
  else
    update public.onboarding_cases set status = 'in_progress' where id = p_id;
  end if;
end $$;

-- ---------- offboarding functions ----------
create or replace function public.submit_resignation(p_reason text, p_requested_lwd date, p_type text default 'resignation', p_employee uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := coalesce(p_employee, public.current_employee_id()); v_id uuid; e public.employees;
begin
  if v_emp <> public.current_employee_id() and not public.has_permission('offboarding.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into e from public.employees where id = v_emp;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Please give a reason'; end if;
  if p_requested_lwd < current_date then raise exception 'Last working day cannot be in the past'; end if;
  insert into public.offboarding_cases(organisation_id, employee_id, separation_type, reason, requested_lwd)
  values (e.organisation_id, v_emp, coalesce(p_type,'resignation'), p_reason, p_requested_lwd) returning id into v_id;
  perform public.submit_for_approval('resignation', v_id, v_emp, 'Resignation · ' || public.employee_name(v_emp),
    'Requested last day ' || to_char(p_requested_lwd, 'DD Mon YYYY') || ' (notice ' || e.notice_period_days || ' days)');
  return v_id;
end $$;

create or replace function public.approval_hook_resignation(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.offboarding_cases; d text;
begin
  if p_status = 'approved' then
    update public.offboarding_cases set status = 'in_clearance', approved_lwd = coalesce(approved_lwd, requested_lwd) where id = p_id returning * into c;
    update public.employees set status = 'notice' where id = c.employee_id;
    insert into public.offboarding_tasks(case_id, title, category, owner_role, sort_order, due_date, is_mandatory)
    select p_id, t.title, t.category, t.owner_role, t.sort_order, c.approved_lwd + t.due_offset_days, t.is_mandatory
    from public.onboarding_templates t where t.organisation_id = c.organisation_id and t.kind = 'offboarding' and t.is_active order by t.sort_order;
    foreach d in array array['reporting_manager','it','finance','admin','hr'] loop
      insert into public.clearance_records(case_id, department) values (p_id, d) on conflict do nothing;
    end loop;
  elsif p_status = 'rejected' then
    update public.offboarding_cases set status = 'rejected' where id = p_id;
  else
    update public.offboarding_cases set status = 'withdrawn' where id = p_id;
  end if;
end $$;

create or replace function public.update_clearance(p_id uuid, p_status text, p_dues numeric default 0, p_remarks text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cr public.clearance_records; v_emp uuid;
begin
  select cr2.* into cr from public.clearance_records cr2 join public.offboarding_cases oc on oc.id = cr2.case_id where cr2.id = p_id and oc.organisation_id = public.current_org_id();
  if cr.id is null then raise exception 'Clearance record not found'; end if;
  select employee_id into v_emp from public.offboarding_cases where id = cr.case_id;
  if not (public.has_permission('offboarding.manage') or (cr.department = 'reporting_manager' and public.is_subordinate(v_emp, public.current_employee_id()))) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.clearance_records set status = p_status, dues_amount = coalesce(p_dues, 0), remarks = p_remarks,
    cleared_by = auth.uid(), cleared_at = case when p_status = 'cleared' then now() end where id = p_id;
end $$;

-- final step: revoke access, exit employee, keep all history
create or replace function public.complete_offboarding(p_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.offboarding_cases; v_user uuid;
begin
  if not public.has_permission('offboarding.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into c from public.offboarding_cases where id = p_case and organisation_id = public.current_org_id() for update;
  if c.status <> 'in_clearance' then raise exception 'Case is not in clearance'; end if;
  if exists (select 1 from public.clearance_records where case_id = p_case and status <> 'cleared') then raise exception 'All departments must clear the employee first'; end if;
  if exists (select 1 from public.offboarding_tasks where case_id = p_case and is_mandatory and status = 'pending') then raise exception 'Complete all mandatory exit tasks'; end if;
  if exists (select 1 from public.employee_assets where employee_id = c.employee_id and status = 'issued') then raise exception 'Company assets are still issued to this employee'; end if;
  update public.offboarding_cases set status = 'completed', exit_completed_at = now() where id = p_case;
  update public.employees set status = 'exited', exit_date = coalesce(c.approved_lwd, c.requested_lwd) where id = c.employee_id returning user_id into v_user;
  insert into public.employee_employment_history(employee_id, event_type, effective_date, from_status, to_status, remarks, created_by)
  values (c.employee_id, 'exit', coalesce(c.approved_lwd, c.requested_lwd), 'notice', 'exited', c.separation_type || ': ' || c.reason, auth.uid());
  -- access revocation: profile deactivated (RLS denies everything); auth ban via admin-users edge function
  update public.user_profiles set is_active = false where id = v_user;
  delete from public.user_roles where user_id = v_user;
  perform public.log_action('EXIT_COMPLETE', 'offboarding_cases', p_case::text, 'Access revoked');
end $$;

-- ---------- learning ----------
create table public.course_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  unique (organisation_id, name)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  category_id uuid references public.course_categories(id),
  title text not null,
  summary text,
  description text,
  cover_url text,
  instructor_name text,
  instructor_bio text,
  duration_minutes int not null default 60,
  level text not null default 'beginner' check (level in ('beginner','intermediate','advanced')),
  is_mandatory boolean not null default false,
  passing_score int not null default 70 check (passing_score between 0 and 100),
  certificate_enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_courses_updated before update on public.courses for each row execute function public.set_updated_at();

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  sort_order int not null default 0
);
create table public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.course_modules(id) on delete cascade,
  title text not null,
  lesson_type text not null default 'text' check (lesson_type in ('text','video','pdf','presentation','link')),
  content text,                 -- markdown body for text lessons
  resource_url text,            -- external video URL or storage path in 'learning-content'
  duration_minutes int not null default 10,
  sort_order int not null default 0
);

create table public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  target_type text not null check (target_type in ('all','department','designation','employee')),
  department_id uuid references public.departments(id),
  designation_id uuid references public.designations(id),
  employee_id uuid references public.employees(id),
  due_date date,
  assigned_by uuid,
  created_at timestamptz not null default now()
);

create table public.course_enrolments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  assignment_id uuid references public.course_assignments(id) on delete set null,
  source text not null default 'self' check (source in ('self','assigned')),
  status text not null default 'enrolled' check (status in ('enrolled','in_progress','completed','failed','withdrawn')),
  progress int not null default 0 check (progress between 0 and 100),
  due_date date,
  enrolled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (course_id, employee_id)
);
create table public.lesson_progress (
  enrolment_id uuid not null references public.course_enrolments(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (enrolment_id, lesson_id)
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null,
  trainer text,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  kind text not null default 'assessment' check (kind in ('quiz','assessment')),
  passing_score int not null default 70,
  time_limit_minutes int,
  max_attempts int not null default 3,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question text not null,
  points int not null default 1,
  sort_order int not null default 0
);
create table public.assessment_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  sort_order int not null default 0
);
create table public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  enrolment_id uuid not null references public.course_enrolments(id) on delete cascade,
  attempt int not null,
  score int not null,
  passed boolean not null,
  submitted_at timestamptz not null default now(),
  unique (assessment_id, enrolment_id, attempt)
);
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null unique references public.course_enrolments(id) on delete cascade,
  certificate_number text not null unique,
  issued_at timestamptz not null default now()
);

-- employees must not read answer keys: column privilege + definer grading
revoke select on public.assessment_options from anon, authenticated;
grant select (id, question_id, option_text, sort_order) on public.assessment_options to authenticated;

create or replace function public.recalc_enrolment(p_enrolment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare en public.course_enrolments; v_total int; v_done int; v_need_assess boolean; v_passed boolean; c public.courses;
begin
  select * into en from public.course_enrolments where id = p_enrolment;
  select * into c from public.courses where id = en.course_id;
  select count(*) into v_total from public.course_lessons l join public.course_modules m on m.id = l.module_id where m.course_id = en.course_id;
  select count(*) into v_done from public.lesson_progress where enrolment_id = p_enrolment;
  v_need_assess := exists (select 1 from public.assessments where course_id = en.course_id and is_active);
  v_passed := not v_need_assess or not exists (
    select 1 from public.assessments a where a.course_id = en.course_id and a.is_active
      and not exists (select 1 from public.assessment_results r where r.assessment_id = a.id and r.enrolment_id = p_enrolment and r.passed));
  update public.course_enrolments set
    progress = case when v_total = 0 then case when v_passed then 100 else 0 end
                    else least(100, round(100.0 * v_done / v_total * case when v_need_assess and not v_passed then 0.9 else 1 end)) end,
    status = case when v_done >= v_total and v_passed then 'completed' when status = 'enrolled' and v_done > 0 then 'in_progress' else status end,
    started_at = coalesce(started_at, case when v_done > 0 then now() end),
    completed_at = case when v_done >= v_total and v_passed then coalesce(completed_at, now()) end
  where id = p_enrolment returning * into en;
  if en.status = 'completed' and c.certificate_enabled then
    insert into public.certificates(enrolment_id, certificate_number)
    values (p_enrolment, 'CERT-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(p_enrolment::text, '-', ''), 1, 8)))
    on conflict (enrolment_id) do nothing;
  end if;
end $$;

create or replace function public.enrol_in_course(p_course uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.courses where id = p_course and organisation_id = public.current_org_id() and status = 'published') then
    raise exception 'Course not available';
  end if;
  insert into public.course_enrolments(course_id, employee_id, source) values (p_course, public.current_employee_id(), 'self')
  on conflict (course_id, employee_id) do update set status = case when course_enrolments.status = 'withdrawn' then 'enrolled' else course_enrolments.status end
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.complete_lesson(p_lesson uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_en uuid; v_progress int;
begin
  select ce.id into v_en from public.course_lessons l join public.course_modules m on m.id = l.module_id
    join public.course_enrolments ce on ce.course_id = m.course_id and ce.employee_id = public.current_employee_id()
   where l.id = p_lesson;
  if v_en is null then raise exception 'Enrol in this course first'; end if;
  insert into public.lesson_progress(enrolment_id, lesson_id) values (v_en, p_lesson) on conflict do nothing;
  perform public.recalc_enrolment(v_en);
  select progress into v_progress from public.course_enrolments where id = v_en;
  return v_progress;
end $$;

-- answers JSON: {"<question_id>": "<option_id>", ...}
create or replace function public.submit_assessment(p_assessment uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assessments; v_en uuid; v_attempt int; v_total int; v_got int; v_score int; v_passed boolean;
begin
  select * into a from public.assessments where id = p_assessment and is_active;
  if not found then raise exception 'Assessment not found'; end if;
  select id into v_en from public.course_enrolments where course_id = a.course_id and employee_id = public.current_employee_id();
  if v_en is null then raise exception 'Enrol in this course first'; end if;
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.assessment_results where assessment_id = p_assessment and enrolment_id = v_en;
  if v_attempt > a.max_attempts then raise exception 'No attempts left (maximum %)', a.max_attempts; end if;
  select coalesce(sum(points), 0) into v_total from public.assessment_questions where assessment_id = p_assessment;
  select coalesce(sum(q.points), 0) into v_got from public.assessment_questions q
    join public.assessment_options o on o.question_id = q.id and o.is_correct
   where q.assessment_id = p_assessment and o.id::text = p_answers->>(q.id::text);
  v_score := case when v_total = 0 then 0 else round(100.0 * v_got / v_total) end;
  v_passed := v_score >= a.passing_score;
  insert into public.assessment_results(assessment_id, enrolment_id, attempt, score, passed) values (p_assessment, v_en, v_attempt, v_score, v_passed);
  if not v_passed and v_attempt >= a.max_attempts then update public.course_enrolments set status = 'failed' where id = v_en; end if;
  perform public.recalc_enrolment(v_en);
  return jsonb_build_object('score', v_score, 'passed', v_passed, 'attempt', v_attempt, 'attempts_left', a.max_attempts - v_attempt);
end $$;

-- assignment fans out into enrolments
create or replace function public.apply_course_assignment(p_assignment uuid) returns int
language plpgsql security definer set search_path = public as $$
declare ca public.course_assignments; n int;
begin
  if not public.has_permission('learning.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into ca from public.course_assignments where id = p_assignment and organisation_id = public.current_org_id();
  with t as (
    insert into public.course_enrolments(course_id, employee_id, assignment_id, source, due_date)
    select ca.course_id, e.id, ca.id, 'assigned', ca.due_date from public.employees e
    where e.organisation_id = ca.organisation_id and e.status in ('active','probation','notice','onboarding')
      and (ca.target_type = 'all' or (ca.target_type = 'department' and e.department_id = ca.department_id)
           or (ca.target_type = 'designation' and e.designation_id = ca.designation_id) or (ca.target_type = 'employee' and e.id = ca.employee_id))
    on conflict (course_id, employee_id) do update set due_date = excluded.due_date, assignment_id = excluded.assignment_id, source = 'assigned'
    returning employee_id)
  select count(*) into n from t;
  perform public.notify(e.user_id, 'learning', 'learning.assigned',
     jsonb_build_object('title', 'New training assigned: ' || c.title, 'due', coalesce(to_char(ca.due_date,'DD Mon YYYY'),'—')), '/me/learning')
  from public.course_enrolments ce join public.employees e on e.id = ce.employee_id join public.courses c on c.id = ce.course_id
  where ce.assignment_id = ca.id;
  return n;
end $$;

-- ---------- RLS ----------
alter table public.onboarding_templates enable row level security;
alter table public.onboarding_cases enable row level security;
alter table public.onboarding_tasks enable row level security;
alter table public.policy_acknowledgements enable row level security;
alter table public.offboarding_cases enable row level security;
alter table public.offboarding_tasks enable row level security;
alter table public.clearance_records enable row level security;
alter table public.exit_interviews enable row level security;
alter table public.course_categories enable row level security;
alter table public.courses enable row level security;
alter table public.course_modules enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_assignments enable row level security;
alter table public.course_enrolments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.training_sessions enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_options enable row level security;
alter table public.assessment_results enable row level security;
alter table public.certificates enable row level security;

create policy obt_read on public.onboarding_templates for select to authenticated using (organisation_id = public.current_org_id());
create policy obt_write on public.onboarding_templates for all to authenticated
  using (organisation_id = public.current_org_id() and (public.has_permission('onboarding.manage') or public.has_permission('offboarding.manage')))
  with check (organisation_id = public.current_org_id());

create policy obc_read on public.onboarding_cases for select to authenticated
  using (employee_id = public.current_employee_id() or (public.can_view_employee(employee_id, 'onboarding')));
create policy obc_write on public.onboarding_cases for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('onboarding.manage')) with check (organisation_id = public.current_org_id());
create policy obtask_read on public.onboarding_tasks for select to authenticated using (exists (select 1 from public.onboarding_cases c where c.id = case_id));
create policy obtask_write on public.onboarding_tasks for all to authenticated
  using (public.has_permission('onboarding.manage')) with check (public.has_permission('onboarding.manage'));

create policy pa_read on public.policy_acknowledgements for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_permission('onboarding.manage') or public.has_permission('engagement.manage'));
create policy pa_insert on public.policy_acknowledgements for insert to authenticated with check (employee_id = public.current_employee_id());

create policy ofc_read on public.offboarding_cases for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_view_employee(employee_id, 'offboarding'));
create policy ofc_write on public.offboarding_cases for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('offboarding.manage')) with check (organisation_id = public.current_org_id());
create policy oft_read on public.offboarding_tasks for select to authenticated using (exists (select 1 from public.offboarding_cases c where c.id = case_id));
create policy oft_write on public.offboarding_tasks for all to authenticated
  using (public.has_permission('offboarding.manage')) with check (public.has_permission('offboarding.manage'));
create policy clr_read on public.clearance_records for select to authenticated using (exists (select 1 from public.offboarding_cases c where c.id = case_id));
create policy exi_read on public.exit_interviews for select to authenticated using (public.has_permission('offboarding.manage'));
create policy exi_write on public.exit_interviews for all to authenticated
  using (public.has_permission('offboarding.manage')) with check (public.has_permission('offboarding.manage'));
create policy exi_self on public.exit_interviews for insert to authenticated
  with check (exists (select 1 from public.offboarding_cases c where c.id = case_id and c.employee_id = public.current_employee_id()));

do $$
declare t text;
begin
  foreach t in array array['course_categories','course_assignments','training_sessions'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (organisation_id = public.current_org_id())', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (organisation_id = public.current_org_id() and public.has_permission(''learning.manage'')) with check (organisation_id = public.current_org_id())', t);
  end loop;
end $$;
create policy courses_read on public.courses for select to authenticated
  using (organisation_id = public.current_org_id() and (status = 'published' or public.has_permission('learning.manage')));
create policy courses_write on public.courses for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('learning.manage')) with check (organisation_id = public.current_org_id());

create policy cm_read on public.course_modules for select to authenticated using (exists (select 1 from public.courses c where c.id = course_id));
create policy cm_write on public.course_modules for all to authenticated using (public.has_permission('learning.manage')) with check (public.has_permission('learning.manage'));
create policy cl_read on public.course_lessons for select to authenticated using (exists (select 1 from public.course_modules m where m.id = module_id));
create policy cl_write on public.course_lessons for all to authenticated using (public.has_permission('learning.manage')) with check (public.has_permission('learning.manage'));

create policy ce_read on public.course_enrolments for select to authenticated using (public.can_view_employee(employee_id, 'learning'));
create policy ce_write on public.course_enrolments for all to authenticated
  using (public.has_permission('learning.manage')) with check (public.has_permission('learning.manage'));
create policy lp_read on public.lesson_progress for select to authenticated using (exists (select 1 from public.course_enrolments e where e.id = enrolment_id));

create policy as_read on public.assessments for select to authenticated using (exists (select 1 from public.courses c where c.id = course_id));
create policy as_write on public.assessments for all to authenticated using (public.has_permission('learning.manage')) with check (public.has_permission('learning.manage'));
create policy aq_read on public.assessment_questions for select to authenticated using (exists (select 1 from public.assessments a where a.id = assessment_id));
create policy aq_write on public.assessment_questions for all to authenticated using (public.has_permission('learning.manage')) with check (public.has_permission('learning.manage'));
create policy ao_read on public.assessment_options for select to authenticated using (exists (select 1 from public.assessment_questions q where q.id = question_id));
create policy ao_write on public.assessment_options for all to authenticated using (public.has_permission('learning.manage')) with check (public.has_permission('learning.manage'));
create policy ares_read on public.assessment_results for select to authenticated using (exists (select 1 from public.course_enrolments e where e.id = enrolment_id));
create policy cert_read on public.certificates for select to authenticated using (exists (select 1 from public.course_enrolments e where e.id = enrolment_id));

-- admins need the answer key for the builder
create or replace function public.assessment_answer_key(p_assessment uuid) returns table (option_id uuid, is_correct boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.is_correct from public.assessment_options o join public.assessment_questions q on q.id = o.question_id
  where q.assessment_id = p_assessment and public.has_permission('learning.manage')
$$;
