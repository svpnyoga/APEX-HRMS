-- =====================================================================
-- 0008 PERFORMANCE APPRAISAL + EMPLOYEE ENGAGEMENT
-- =====================================================================
create table public.rating_scales (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);
create table public.rating_scale_levels (
  id uuid primary key default gen_random_uuid(),
  scale_id uuid not null references public.rating_scales(id) on delete cascade,
  value int not null,
  label text not null,
  description text,
  unique (scale_id, value)
);

create table public.appraisal_cycles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  cycle_type text not null default 'annual' check (cycle_type in ('annual','half_yearly','quarterly')),
  period_start date not null,
  period_end date not null,
  self_review_due date,
  manager_review_due date,
  hr_review_due date,
  rating_scale_id uuid references public.rating_scales(id),
  status text not null default 'draft' check (status in ('draft','goal_setting','in_review','closed')),
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);

create table public.performance_kpis (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  department_id uuid references public.departments(id),
  designation_id uuid references public.designations(id),
  unit text,
  target_value text,
  default_weight numeric(5,2) not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.performance_goals (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.appraisal_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  kpi_id uuid references public.performance_kpis(id),
  title text not null,
  description text,
  target text,
  weight numeric(5,2) not null check (weight > 0 and weight <= 100),
  progress int not null default 0 check (progress between 0 and 100),
  status text not null default 'active' check (status in ('draft','active','completed','dropped')),
  due_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.performance_goals(cycle_id, employee_id);
create trigger trg_goals_updated before update on public.performance_goals for each row execute function public.set_updated_at();

create table public.appraisal_reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.appraisal_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  stage text not null check (stage in ('self','manager','hr')),
  reviewer_employee_id uuid references public.employees(id),
  status text not null default 'pending' check (status in ('pending','submitted')),
  weighted_score numeric(4,2),
  overall_rating int,
  strengths text,
  improvements text,
  comments text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, employee_id, stage)
);

create table public.appraisal_ratings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.appraisal_reviews(id) on delete cascade,
  goal_id uuid not null references public.performance_goals(id) on delete cascade,
  rating int not null,
  comment text,
  unique (review_id, goal_id)
);

create table public.appraisal_finals (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.appraisal_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  final_score numeric(4,2),
  final_rating int,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_at timestamptz,
  unique (cycle_id, employee_id)
);

create table public.performance_feedback (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  from_employee_id uuid not null references public.employees(id) on delete cascade,
  to_employee_id uuid not null references public.employees(id) on delete cascade,
  feedback_type text not null default 'praise' check (feedback_type in ('praise','constructive','request')),
  message text not null,
  visibility text not null default 'private' check (visibility in ('private','manager')),
  cycle_id uuid references public.appraisal_cycles(id),
  created_at timestamptz not null default now(),
  check (from_employee_id <> to_employee_id)
);

create table public.development_plans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  cycle_id uuid references public.appraisal_cycles(id) on delete set null,
  focus_area text not null,
  actions text not null,
  due_date date,
  status text not null default 'open' check (status in ('open','in_progress','done')),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- PUBLIC (performance.manage): start reviews for a cycle
create or replace function public.launch_appraisal_reviews(p_cycle uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c public.appraisal_cycles; e record; n int := 0;
begin
  if not public.has_permission('performance.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into c from public.appraisal_cycles where id = p_cycle and organisation_id = public.current_org_id();
  if not found then raise exception 'Cycle not found'; end if;
  for e in select emp.id, emp.reporting_manager_id from public.employees emp
           where emp.organisation_id = c.organisation_id and emp.status in ('active','probation','notice') and emp.deleted_at is null
             and emp.date_of_joining <= c.period_end loop
    insert into public.appraisal_reviews(cycle_id, employee_id, stage, reviewer_employee_id) values (p_cycle, e.id, 'self', e.id) on conflict do nothing;
    insert into public.appraisal_reviews(cycle_id, employee_id, stage, reviewer_employee_id) values (p_cycle, e.id, 'manager', e.reporting_manager_id) on conflict do nothing;
    insert into public.appraisal_reviews(cycle_id, employee_id, stage) values (p_cycle, e.id, 'hr') on conflict do nothing;
    perform public.notify(public.employee_user_id(e.id), 'performance', 'appraisal.self_due',
      jsonb_build_object('title', 'Self assessment open: ' || c.name, 'cycle', c.name), '/me/performance');
    n := n + 1;
  end loop;
  update public.appraisal_cycles set status = 'in_review' where id = p_cycle;
  return n;
end $$;

-- PUBLIC: submit a review stage. Ratings JSON: [{"goal_id": "...", "rating": 4, "comment": "..."}]
create or replace function public.submit_appraisal_review(p_review uuid, p_ratings jsonb, p_overall int, p_strengths text, p_improvements text, p_comments text) returns numeric
language plpgsql security definer set search_path = public as $$
declare rv public.appraisal_reviews; v_me uuid := public.current_employee_id(); x jsonb; v_score numeric; v_max int; c public.appraisal_cycles; v_final uuid;
begin
  select * into rv from public.appraisal_reviews where id = p_review for update;
  if not found then raise exception 'Review not found'; end if;
  select * into c from public.appraisal_cycles where id = rv.cycle_id;
  if c.status <> 'in_review' then raise exception 'This cycle is not open for reviews'; end if;
  if rv.status = 'submitted' then raise exception 'This review has already been submitted'; end if;
  if rv.stage = 'self' and rv.employee_id <> v_me then raise exception 'Only the employee can submit a self assessment' using errcode = '42501'; end if;
  if rv.stage = 'manager' and not (public.is_subordinate(rv.employee_id, v_me) or public.has_permission('performance.manage')) then
    raise exception 'Only the reporting manager can submit this review' using errcode = '42501';
  end if;
  if rv.stage = 'hr' and not public.has_permission('performance.manage') then raise exception 'Only HR can submit this review' using errcode = '42501'; end if;
  if rv.stage = 'manager' and exists (select 1 from public.appraisal_reviews where cycle_id = rv.cycle_id and employee_id = rv.employee_id and stage = 'self' and status = 'pending')
     and current_date <= coalesce(c.self_review_due, c.period_end) then
    raise exception 'Waiting for the employee''s self assessment';
  end if;
  select coalesce(max(value), 5) into v_max from public.rating_scale_levels where scale_id = c.rating_scale_id;
  delete from public.appraisal_ratings where review_id = p_review;
  for x in select * from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
    if (x->>'rating')::int < 1 or (x->>'rating')::int > v_max then raise exception 'Ratings must be between 1 and %', v_max; end if;
    insert into public.appraisal_ratings(review_id, goal_id, rating, comment)
    select p_review, g.id, (x->>'rating')::int, x->>'comment' from public.performance_goals g
    where g.id = (x->>'goal_id')::uuid and g.employee_id = rv.employee_id and g.cycle_id = rv.cycle_id;
  end loop;
  select round(sum(ar.rating * g.weight) / nullif(sum(g.weight), 0), 2) into v_score
    from public.appraisal_ratings ar join public.performance_goals g on g.id = ar.goal_id where ar.review_id = p_review;
  update public.appraisal_reviews set status = 'submitted', submitted_at = now(), weighted_score = v_score,
    overall_rating = coalesce(p_overall, round(v_score)::int), strengths = p_strengths, improvements = p_improvements, comments = p_comments,
    reviewer_employee_id = coalesce(reviewer_employee_id, v_me)
  where id = p_review;
  if rv.stage = 'self' then
    perform public.notify(public.employee_user_id((select reporting_manager_id from public.employees where id = rv.employee_id)), 'performance', 'appraisal.manager_due',
      jsonb_build_object('title', 'Review ' || public.employee_name(rv.employee_id) || ' for ' || c.name), '/performance/manager');
  elsif rv.stage = 'hr' then
    insert into public.appraisal_finals(cycle_id, employee_id, final_score, final_rating)
    values (rv.cycle_id, rv.employee_id, v_score, coalesce(p_overall, round(v_score)::int))
    on conflict (cycle_id, employee_id) do update set final_score = excluded.final_score, final_rating = excluded.final_rating, status = 'pending'
    returning id into v_final;
    perform public.submit_for_approval('appraisal', v_final, rv.employee_id, 'Appraisal result · ' || public.employee_name(rv.employee_id),
      c.name || ' · rating ' || coalesce(p_overall, round(v_score)::int));
  end if;
  return v_score;
end $$;

create or replace function public.approval_hook_appraisal(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.appraisal_finals set status = case when p_status = 'approved' then 'approved' else 'rejected' end,
    approved_at = case when p_status = 'approved' then now() end where id = p_id;
end $$;

-- ---------- engagement ----------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null,
  body text not null,
  category text not null default 'announcement' check (category in ('announcement','news','communication','policy','notice')),
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  audience text not null default 'all' check (audience in ('all','department','location')),
  department_id uuid references public.departments(id),
  location_id uuid references public.locations(id),
  requires_acknowledgement boolean not null default false,
  policy_version text,
  attachment_path text,
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.announcements(organisation_id, status, publish_at desc);
create trigger trg_ann_updated before update on public.announcements for each row execute function public.set_updated_at();

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, employee_id)
);

create or replace function public.announcement_visible_to(a public.announcements, p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a.status = 'published' and a.publish_at <= now() and (a.expires_at is null or a.expires_at > now())
     and (a.audience = 'all'
       or (a.audience = 'department' and a.department_id = (select department_id from public.employees where id = p_employee))
       or (a.audience = 'location' and a.location_id = (select location_id from public.employees where id = p_employee)))
$$;

create view public.my_announcements as
  select a.*, ar.read_at, ar.acknowledged_at
  from public.announcements a
  left join public.announcement_recipients ar on ar.announcement_id = a.id and ar.employee_id = public.current_employee_id()
  where a.organisation_id = public.current_org_id() and public.announcement_visible_to(a, public.current_employee_id());
grant select on public.my_announcements to authenticated;

create or replace function public.mark_announcement(p_announcement uuid, p_acknowledge boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); a public.announcements;
begin
  select * into a from public.announcements where id = p_announcement;
  if v_emp is null or not public.announcement_visible_to(a, v_emp) then raise exception 'Announcement not available'; end if;
  insert into public.announcement_recipients(announcement_id, employee_id, read_at, acknowledged_at)
  values (p_announcement, v_emp, now(), case when p_acknowledge then now() end)
  on conflict (announcement_id, employee_id) do update set read_at = coalesce(announcement_recipients.read_at, now()),
     acknowledged_at = case when p_acknowledge then coalesce(announcement_recipients.acknowledged_at, now()) else announcement_recipients.acknowledged_at end;
end $$;

-- notify audience when published (scheduled posts notify via cron)
create or replace function public.publish_announcement(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare a public.announcements; e record; n int := 0;
begin
  if not public.has_permission('engagement.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.announcements set status = 'published' where id = p_id and organisation_id = public.current_org_id() returning * into a;
  if a.publish_at > now() then return 0; end if;
  for e in select id, user_id from public.employees where organisation_id = a.organisation_id and status not in ('exited','inactive') loop
    if public.announcement_visible_to(a, e.id) then
      perform public.notify(e.user_id, 'announcements', 'announcement.published',
        jsonb_build_object('title', a.title, 'body', left(a.body, 160)), '/me/announcements', 'announcement', a.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create table public.employee_feedback (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,   -- null when anonymous
  feedback_type text not null default 'suggestion' check (feedback_type in ('feedback','suggestion','grievance','appreciation')),
  subject text not null,
  message text not null,
  is_anonymous boolean not null default false,
  department_id uuid references public.departments(id),
  status text not null default 'open' check (status in ('open','in_review','resolved','closed')),
  response text,
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.employee_recognition (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  from_employee_id uuid not null references public.employees(id) on delete cascade,
  to_employee_id uuid not null references public.employees(id) on delete cascade,
  badge text not null check (badge in ('teamwork','innovation','customer_first','ownership','excellence','safety')),
  message text not null,
  created_at timestamptz not null default now(),
  check (from_employee_id <> to_employee_id)
);

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null,
  description text,
  is_anonymous boolean not null default true,
  starts_on date not null default current_date,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft','active','closed')),
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  question text not null,
  question_type text not null default 'rating' check (question_type in ('rating','single_choice','yes_no','text')),
  options text[],
  is_required boolean not null default true,
  sort_order int not null default 0
);
create table public.survey_participation (
  survey_id uuid not null references public.surveys(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  responded_at timestamptz not null default now(),
  primary key (survey_id, employee_id)
);
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,     -- null for anonymous surveys
  submitted_at timestamptz not null default now()
);
create table public.survey_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.survey_responses(id) on delete cascade,
  question_id uuid not null references public.survey_questions(id) on delete cascade,
  answer_text text,
  answer_number numeric
);

create or replace function public.submit_survey(p_survey uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.surveys; v_emp uuid := public.current_employee_id(); v_resp uuid; q public.survey_questions; v text;
begin
  select * into s from public.surveys where id = p_survey and organisation_id = public.current_org_id();
  if not found or s.status <> 'active' or current_date not between s.starts_on and s.ends_on then raise exception 'Survey is not open'; end if;
  insert into public.survey_participation(survey_id, employee_id) values (p_survey, v_emp);   -- PK blocks double voting
  insert into public.survey_responses(survey_id, employee_id) values (p_survey, case when s.is_anonymous then null else v_emp end) returning id into v_resp;
  for q in select * from public.survey_questions where survey_id = p_survey loop
    v := p_answers->>(q.id::text);
    if q.is_required and coalesce(trim(v), '') = '' then raise exception 'Please answer: %', q.question; end if;
    if v is not null then
      insert into public.survey_answers(response_id, question_id, answer_text, answer_number)
      values (v_resp, q.id, v, case when q.question_type = 'rating' then v::numeric end);
    end if;
  end loop;
end $$;

create table public.company_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null,
  description text,
  event_type text not null default 'celebration' check (event_type in ('celebration','training','town_hall','sports','csr','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.event_rsvps (
  event_id uuid not null references public.company_events(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  response text not null check (response in ('going','maybe','not_going')),
  responded_at timestamptz not null default now(),
  primary key (event_id, employee_id)
);

-- birthdays & anniversaries (month-day only, no birth year exposed)
create or replace function public.upcoming_celebrations(p_days int default 30)
returns table (employee_id uuid, full_name text, photo_url text, department_name text, kind text, on_date date, years int)
language sql stable security definer set search_path = public as $$
  with base as (
    select e.id, trim(e.first_name||' '||e.last_name) n, e.photo_url, d.name dn, e.date_of_birth dob, e.date_of_joining doj
    from public.employees e left join public.departments d on d.id = e.department_id
    where e.organisation_id = public.current_org_id() and e.status in ('active','probation','notice') and e.deleted_at is null
  ), b as (
    select id, n, photo_url, dn, 'birthday'::text kind,
      (make_date(extract(year from current_date)::int, extract(month from dob)::int, least(extract(day from dob)::int, 28)) +
       (extract(day from dob)::int - least(extract(day from dob)::int, 28))) d, null::int yrs
    from base where dob is not null
    union all
    select id, n, photo_url, dn, 'anniversary',
      (make_date(extract(year from current_date)::int, extract(month from doj)::int, least(extract(day from doj)::int, 28)) +
       (extract(day from doj)::int - least(extract(day from doj)::int, 28))),
      extract(year from current_date)::int - extract(year from doj)::int
    from base where doj < current_date - 300
  ), c as (
    select id, n, photo_url, dn, kind, case when d < current_date then (d + interval '1 year')::date else d end d,
           case when kind = 'anniversary' and d < current_date then yrs + 1 else yrs end yrs from b
  )
  select id, n, photo_url, dn, kind, d, yrs from c where d <= current_date + p_days and (kind = 'birthday' or yrs > 0) order by d
$$;

-- ---------- RLS ----------
alter table public.rating_scales enable row level security;
alter table public.rating_scale_levels enable row level security;
alter table public.appraisal_cycles enable row level security;
alter table public.performance_kpis enable row level security;
alter table public.performance_goals enable row level security;
alter table public.appraisal_reviews enable row level security;
alter table public.appraisal_ratings enable row level security;
alter table public.appraisal_finals enable row level security;
alter table public.performance_feedback enable row level security;
alter table public.development_plans enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.employee_feedback enable row level security;
alter table public.employee_recognition enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_participation enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_answers enable row level security;
alter table public.company_events enable row level security;
alter table public.event_rsvps enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rating_scales','appraisal_cycles','performance_kpis'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (organisation_id = public.current_org_id())', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (organisation_id = public.current_org_id() and public.has_permission(''performance.manage'')) with check (organisation_id = public.current_org_id())', t);
  end loop;
end $$;
create policy rsl_read on public.rating_scale_levels for select to authenticated
  using (exists (select 1 from public.rating_scales s where s.id = scale_id and s.organisation_id = public.current_org_id()));
create policy rsl_write on public.rating_scale_levels for all to authenticated
  using (public.has_permission('performance.manage')) with check (public.has_permission('performance.manage'));

create policy goals_read on public.performance_goals for select to authenticated using (public.can_view_employee(employee_id, 'performance'));
create policy goals_insert on public.performance_goals for insert to authenticated
  with check (employee_id = public.current_employee_id() or public.has_permission('performance.manage')
              or public.is_subordinate(employee_id, public.current_employee_id()));
create policy goals_update on public.performance_goals for update to authenticated
  using (employee_id = public.current_employee_id() or public.has_permission('performance.manage') or public.is_subordinate(employee_id, public.current_employee_id()))
  with check (true);
create policy goals_delete on public.performance_goals for delete to authenticated
  using (public.has_permission('performance.manage') or public.is_subordinate(employee_id, public.current_employee_id()));

-- employees see their own manager/HR reviews only after they are submitted
create policy reviews_read on public.appraisal_reviews for select to authenticated
  using ((employee_id = public.current_employee_id() and (stage = 'self' or status = 'submitted'))
         or (employee_id <> public.current_employee_id() and public.can_view_employee(employee_id, 'performance')));
create policy ratings_read on public.appraisal_ratings for select to authenticated
  using (exists (select 1 from public.appraisal_reviews r where r.id = review_id));
create policy finals_read on public.appraisal_finals for select to authenticated using (public.can_view_employee(employee_id, 'performance'));

create policy fb_read on public.performance_feedback for select to authenticated
  using (to_employee_id = public.current_employee_id() or from_employee_id = public.current_employee_id()
         or (visibility = 'manager' and public.is_subordinate(to_employee_id, public.current_employee_id()))
         or public.has_permission('performance.manage'));
create policy fb_insert on public.performance_feedback for insert to authenticated
  with check (from_employee_id = public.current_employee_id() and organisation_id = public.current_org_id());

create policy dp_read on public.development_plans for select to authenticated using (public.can_view_employee(employee_id, 'performance'));
create policy dp_write on public.development_plans for all to authenticated
  using (public.has_permission('performance.manage') or public.is_subordinate(employee_id, public.current_employee_id()) or employee_id = public.current_employee_id())
  with check (public.has_permission('performance.manage') or public.is_subordinate(employee_id, public.current_employee_id()) or employee_id = public.current_employee_id());

create policy ann_read on public.announcements for select to authenticated
  using (organisation_id = public.current_org_id() and (public.has_permission('engagement.manage') or public.announcement_visible_to(announcements, public.current_employee_id())));
create policy ann_write on public.announcements for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('engagement.manage')) with check (organisation_id = public.current_org_id());
create policy annr_read on public.announcement_recipients for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_permission('engagement.manage'));

create policy efb_read on public.employee_feedback for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('engagement.manage')));
create policy efb_insert on public.employee_feedback for insert to authenticated
  with check (organisation_id = public.current_org_id() and ((is_anonymous and employee_id is null) or (not is_anonymous and employee_id = public.current_employee_id())));
create policy efb_update on public.employee_feedback for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('engagement.manage')) with check (organisation_id = public.current_org_id());

create policy rec_read_all on public.employee_recognition for select to authenticated using (organisation_id = public.current_org_id());
create policy rec_insert on public.employee_recognition for insert to authenticated
  with check (organisation_id = public.current_org_id() and from_employee_id = public.current_employee_id());

create policy surveys_read on public.surveys for select to authenticated
  using (organisation_id = public.current_org_id() and (status <> 'draft' or public.has_permission('engagement.manage')));
create policy surveys_write on public.surveys for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('engagement.manage')) with check (organisation_id = public.current_org_id());
create policy sq_read on public.survey_questions for select to authenticated using (exists (select 1 from public.surveys s where s.id = survey_id));
create policy sq_write on public.survey_questions for all to authenticated using (public.has_permission('engagement.manage')) with check (public.has_permission('engagement.manage'));
create policy sp_read on public.survey_participation for select to authenticated using (employee_id = public.current_employee_id() or public.has_permission('engagement.manage'));
create policy sr_read_admin on public.survey_responses for select to authenticated using (public.has_permission('engagement.manage') and exists (select 1 from public.surveys s where s.id = survey_id));
create policy sa_read_admin on public.survey_answers for select to authenticated using (public.has_permission('engagement.manage'));

create policy ev_read_all on public.company_events for select to authenticated using (organisation_id = public.current_org_id());
create policy ev_write on public.company_events for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('engagement.manage')) with check (organisation_id = public.current_org_id());
create policy rsvp_read on public.event_rsvps for select to authenticated using (exists (select 1 from public.company_events e where e.id = event_id));
create policy rsvp_own on public.event_rsvps for insert to authenticated with check (employee_id = public.current_employee_id());
create policy rsvp_upd on public.event_rsvps for update to authenticated using (employee_id = public.current_employee_id()) with check (employee_id = public.current_employee_id());
