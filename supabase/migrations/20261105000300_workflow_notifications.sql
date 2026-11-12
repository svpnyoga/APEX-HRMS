-- =====================================================================
-- 0003 REUSABLE APPROVAL ENGINE + NOTIFICATIONS
-- One engine drives leave, regularisation, permissions, claims, payroll,
-- salary revisions, encashment, appraisals, onboarding and resignations.
-- =====================================================================

-- ---------- notifications ----------
create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  code text not null,                       -- e.g. 'approval.pending'
  title_template text not null,             -- supports {{placeholders}}
  body_template text not null,
  send_email boolean not null default true,
  is_active boolean not null default true,
  unique (organisation_id, code)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  category text not null default 'general',
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications(user_id, read_at, created_at desc);

create table public.notification_preferences (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  category text not null,
  in_app boolean not null default true,
  email boolean not null default true,
  push boolean not null default false,
  primary key (user_id, category)
);

-- emails are queued; the process-email-outbox edge function delivers them
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.email_outbox(status, created_at);

create or replace function public.render_template(p_text text, p_params jsonb) returns text
language plpgsql immutable as $$
declare k text; v text; r text := p_text;
begin
  if p_params is null then return r; end if;
  for k, v in select key, value from jsonb_each_text(p_params) loop
    r := replace(r, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return r;
end $$;

-- Central notify(): respects preferences and templates, queues email.
create or replace function public.notify(
  p_user uuid, p_category text, p_template text, p_params jsonb,
  p_link text default null, p_entity_type text default null, p_entity_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_email text; t public.notification_templates;
  v_title text; v_body text; pref public.notification_preferences;
begin
  if p_user is null then return; end if;
  select organisation_id, email into v_org, v_email from public.user_profiles where id = p_user and is_active;
  if v_org is null then return; end if;
  select * into t from public.notification_templates
   where code = p_template and is_active and (organisation_id = v_org or organisation_id is null)
   order by organisation_id nulls last limit 1;
  v_title := public.render_template(coalesce(t.title_template, p_params->>'title', p_template), p_params);
  v_body  := public.render_template(coalesce(t.body_template, p_params->>'body', ''), p_params);
  select * into pref from public.notification_preferences where user_id = p_user and category = p_category;
  if coalesce(pref.in_app, true) then
    insert into public.notifications(organisation_id, user_id, category, title, body, link, entity_type, entity_id)
    values (v_org, p_user, p_category, v_title, v_body, p_link, p_entity_type, p_entity_id);
  end if;
  if coalesce(pref.email, true) and coalesce(t.send_email, false) and v_email is not null then
    insert into public.email_outbox(organisation_id, to_email, subject, body) values (v_org, v_email, v_title, v_body);
  end if;
end $$;

-- notify every active user holding a permission (e.g. HR)
create or replace function public.notify_permission(p_org uuid, p_permission text, p_category text, p_template text, p_params jsonb, p_link text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in
    select distinct up.id from public.user_profiles up
    join public.user_roles ur on ur.user_id = up.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    where up.organisation_id = p_org and up.is_active and (rp.permission_code = p_permission or rp.permission_code = '*')
  loop
    perform public.notify(u, p_category, p_template, p_params, p_link);
  end loop;
end $$;

-- ---------- approval engine ----------
create table public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'leave','attendance_regularisation','attendance_permission','overtime','expense_claim',
    'payroll_run','salary_revision','leave_encashment','appraisal','onboarding','resignation')),
  name text not null,
  is_active boolean not null default true,
  auto_approve_if_no_approver boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, entity_type)
);
create trigger trg_wf_updated before update on public.approval_workflows for each row execute function public.set_updated_at();

create table public.approval_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.approval_workflows(id) on delete cascade,
  step_order int not null check (step_order > 0),
  name text not null,
  approver_type text not null check (approver_type in ('reporting_manager','department_head','role','user','skip_level_manager')),
  role_id uuid references public.roles(id),
  user_id uuid references public.user_profiles(id),
  mode text not null default 'any' check (mode in ('any','all')),   -- parallel: any one / all must approve
  escalate_after_hours int,                                         -- null = never
  escalate_to_role_id uuid references public.roles(id),
  -- optional condition, e.g. only for claims above an amount
  min_amount numeric(14,2),
  unique (workflow_id, step_order)
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  workflow_id uuid references public.approval_workflows(id),
  entity_type text not null,
  entity_id uuid not null,
  requester_employee_id uuid references public.employees(id),
  title text not null,
  summary text,
  amount numeric(14,2),
  current_step int not null default 1,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (entity_type, entity_id)
);
create index on public.approval_requests(organisation_id, status);

create table public.approval_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  step_order int not null,
  step_name text not null,
  approver_user_id uuid not null references public.user_profiles(id),
  delegated_from_user_id uuid references public.user_profiles(id),
  mode text not null default 'any',
  status text not null default 'pending' check (status in ('pending','approved','rejected','skipped','escalated')),
  comment text,
  acted_at timestamptz,
  due_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.approval_tasks(approver_user_id, status);
create index on public.approval_tasks(request_id, step_order);

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  from_user_id uuid not null references public.user_profiles(id) on delete cascade,
  to_user_id uuid not null references public.user_profiles(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  entity_type text,                     -- null = all
  is_active boolean not null default true,
  check (ends_on >= starts_on),
  check (from_user_id <> to_user_id)
);

-- resolve a step to concrete approver user ids
create or replace function public.resolve_step_approvers(p_step public.approval_workflow_steps, p_requester uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public as $$
declare v_mgr uuid; v_org uuid;
begin
  select organisation_id into v_org from public.employees where id = p_requester;
  if p_step.approver_type = 'reporting_manager' then
    return query select m.user_id from public.employees e join public.employees m on m.id = e.reporting_manager_id
                 where e.id = p_requester and m.user_id is not null and m.status not in ('exited','inactive');
  elsif p_step.approver_type = 'skip_level_manager' then
    select m.reporting_manager_id into v_mgr from public.employees e join public.employees m on m.id = e.reporting_manager_id where e.id = p_requester;
    return query select user_id from public.employees where id = v_mgr and user_id is not null;
  elsif p_step.approver_type = 'department_head' then
    return query select h.user_id from public.employees e join public.departments d on d.id = e.department_id
                 join public.employees h on h.id = d.head_employee_id where e.id = p_requester and h.user_id is not null;
  elsif p_step.approver_type = 'role' then
    return query select distinct ur.user_id from public.user_roles ur join public.user_profiles up on up.id = ur.user_id
                 where ur.role_id = p_step.role_id and up.is_active and up.organisation_id = v_org;
  elsif p_step.approver_type = 'user' then
    return query select p_step.user_id where p_step.user_id is not null;
  end if;
end $$;

-- apply active delegation
create or replace function public.delegate_for(p_user uuid, p_entity text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select to_user_id from public.approval_delegations
                   where from_user_id = p_user and is_active and current_date between starts_on and ends_on
                     and (entity_type is null or entity_type = p_entity)
                   order by starts_on desc limit 1), p_user)
$$;

-- create tasks for a step; returns number of tasks created (0 => step skipped)
create or replace function public.create_step_tasks(p_request uuid, p_step_order int) returns int
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests; s public.approval_workflow_steps; u uuid; v_target uuid; n int := 0;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into s from public.approval_workflow_steps where workflow_id = r.workflow_id and step_order = p_step_order;
  if not found then return -1; end if;
  if s.min_amount is not null and coalesce(r.amount, 0) < s.min_amount then return 0; end if;
  for u in select distinct x from public.resolve_step_approvers(s, r.requester_employee_id) as x loop
    v_target := public.delegate_for(u, r.entity_type);
    -- requesters never approve their own request
    if v_target = public.employee_user_id(r.requester_employee_id) then continue; end if;
    insert into public.approval_tasks(request_id, step_order, step_name, approver_user_id, delegated_from_user_id, mode, due_at)
    values (r.id, s.step_order, s.name, v_target, case when v_target <> u then u end, s.mode,
            case when s.escalate_after_hours is not null then now() + make_interval(hours => s.escalate_after_hours) end);
    perform public.notify(v_target, 'approvals', 'approval.pending',
      jsonb_build_object('title', 'Approval needed: ' || r.title, 'request', r.title,
                         'requester', public.employee_name(r.requester_employee_id), 'step', s.name),
      '/approvals', r.entity_type, r.entity_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- move the request forward from p_from_step until a step produces tasks, or finish
create or replace function public.advance_request(p_request uuid, p_from_step int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_step int := p_from_step; v_created int; v_max int; r public.approval_requests; wf public.approval_workflows;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into wf from public.approval_workflows where id = r.workflow_id;
  select coalesce(max(step_order), 0) into v_max from public.approval_workflow_steps where workflow_id = r.workflow_id;
  loop
    if v_step > v_max then
      perform public.complete_request(p_request, 'approved', null);
      return;
    end if;
    v_created := public.create_step_tasks(p_request, v_step);
    if v_created > 0 then
      update public.approval_requests set current_step = v_step where id = p_request;
      return;
    end if;
    -- no approver could be resolved for this step: escalate to HR admins unless step was conditional
    if v_created = 0 and not exists (
        select 1 from public.approval_workflow_steps s where s.workflow_id = r.workflow_id and s.step_order = v_step
          and s.min_amount is not null and coalesce(r.amount,0) < s.min_amount) then
      if not wf.auto_approve_if_no_approver then
        insert into public.approval_tasks(request_id, step_order, step_name, approver_user_id, mode)
        select r.id, v_step, 'HR fallback', up.id, 'any'
        from public.user_profiles up
        join public.user_roles ur on ur.user_id = up.id join public.roles ro on ro.id = ur.role_id
        where up.organisation_id = r.organisation_id and up.is_active and ro.code in ('hr_admin','super_admin')
          and up.id <> coalesce(public.employee_user_id(r.requester_employee_id), '00000000-0000-0000-0000-000000000000'::uuid)
        on conflict do nothing;
        if found then
          update public.approval_requests set current_step = v_step where id = p_request;
          return;
        end if;
      end if;
    end if;
    v_step := v_step + 1;
  end loop;
end $$;

-- module hook dispatch: each module provides public.approval_hook_<entity>(uuid, text, text)
create or replace function public.complete_request(p_request uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.approval_requests; v_fn regprocedure;
begin
  update public.approval_requests set status = p_status, completed_at = now() where id = p_request returning * into r;
  update public.approval_tasks set status = 'skipped' where request_id = p_request and status = 'pending';
  v_fn := to_regprocedure('public.approval_hook_' || r.entity_type || '(uuid,text,text)');
  if v_fn is not null then
    execute format('select public.%I($1, $2, $3)', 'approval_hook_' || r.entity_type) using r.entity_id, p_status, p_comment;
  end if;
  perform public.notify(public.employee_user_id(r.requester_employee_id), 'approvals', 'approval.completed',
    jsonb_build_object('title', r.title || ' was ' || p_status, 'request', r.title, 'status', p_status, 'comment', coalesce(p_comment,'')),
    '/me', r.entity_type, r.entity_id);
end $$;

-- PUBLIC: submit an entity for approval
create or replace function public.submit_for_approval(
  p_entity_type text, p_entity_id uuid, p_requester uuid, p_title text, p_summary text default null, p_amount numeric default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid; wf public.approval_workflows; v_id uuid;
begin
  select organisation_id into v_org from public.employees where id = p_requester;
  if v_org is null then raise exception 'Requester not found'; end if;
  select * into wf from public.approval_workflows where organisation_id = v_org and entity_type = p_entity_type and is_active;
  insert into public.approval_requests(organisation_id, workflow_id, entity_type, entity_id, requester_employee_id, title, summary, amount)
  values (v_org, wf.id, p_entity_type, p_entity_id, p_requester, p_title, p_summary, p_amount)
  on conflict (entity_type, entity_id) do update
    set status = 'pending', current_step = 1, submitted_at = now(), completed_at = null, title = excluded.title, summary = excluded.summary, amount = excluded.amount
  returning id into v_id;
  delete from public.approval_tasks where request_id = v_id and status = 'pending';
  if wf.id is null then
    -- no workflow configured: auto-approve is never silent; HR gets a single step
    insert into public.approval_tasks(request_id, step_order, step_name, approver_user_id, mode)
    select v_id, 1, 'HR', up.id, 'any' from public.user_profiles up
      join public.user_roles ur on ur.user_id = up.id join public.roles ro on ro.id = ur.role_id
     where up.organisation_id = v_org and up.is_active and ro.code in ('hr_admin','super_admin')
       and up.id <> coalesce(public.employee_user_id(p_requester), '00000000-0000-0000-0000-000000000000'::uuid)
    on conflict do nothing;
    if not found then perform public.complete_request(v_id, 'approved', 'No approver configured'); end if;
  else
    perform public.advance_request(v_id, 1);
  end if;
  return v_id;
end $$;

-- PUBLIC: act on a task
create or replace function public.act_on_approval(p_task uuid, p_action text, p_comment text default null) returns text
language plpgsql security definer set search_path = public as $$
declare t public.approval_tasks; r public.approval_requests; v_pending int; v_approved int;
begin
  if p_action not in ('approve','reject') then raise exception 'Invalid action'; end if;
  select * into t from public.approval_tasks where id = p_task for update;
  if not found then raise exception 'Approval task not found'; end if;
  if t.approver_user_id <> auth.uid() then raise exception 'This approval is assigned to someone else' using errcode = '42501'; end if;
  if t.status <> 'pending' then raise exception 'This approval has already been actioned'; end if;
  select * into r from public.approval_requests where id = t.request_id for update;
  if r.status <> 'pending' then raise exception 'Request is no longer pending'; end if;
  if p_action = 'reject' and coalesce(trim(p_comment), '') = '' then
    raise exception 'A reason is required to reject';
  end if;

  update public.approval_tasks set status = case when p_action = 'approve' then 'approved' else 'rejected' end,
         comment = p_comment, acted_at = now() where id = p_task;

  if p_action = 'reject' then
    perform public.complete_request(r.id, 'rejected', p_comment);
    return 'rejected';
  end if;

  select count(*) filter (where status = 'pending'), count(*) filter (where status = 'approved')
    into v_pending, v_approved
    from public.approval_tasks where request_id = r.id and step_order = t.step_order;

  if t.mode = 'all' and v_pending > 0 then
    return 'waiting';                 -- parallel step: others still have to approve
  end if;
  update public.approval_tasks set status = 'skipped' where request_id = r.id and step_order = t.step_order and status = 'pending';
  perform public.advance_request(r.id, t.step_order + 1);
  select status into r.status from public.approval_requests where id = r.id;
  return case when r.status = 'approved' then 'approved' else 'advanced' end;
end $$;

-- PUBLIC: requester cancels / withdraws
create or replace function public.cancel_approval(p_entity_type text, p_entity_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.approval_requests;
begin
  select * into r from public.approval_requests where entity_type = p_entity_type and entity_id = p_entity_id;
  if not found then return; end if;
  if r.requester_employee_id <> public.current_employee_id() and not public.has_permission('admin.workflows') then
    raise exception 'Only the requester can withdraw this request' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'Only pending requests can be withdrawn'; end if;
  perform public.complete_request(r.id, 'cancelled', 'Withdrawn');
end $$;

-- CRON: escalate overdue tasks + send reminders
create or replace function public.escalate_overdue_approvals() returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0; u uuid;
begin
  for t in
    select at.*, s.escalate_to_role_id, ar.organisation_id, ar.title, ar.entity_type, ar.entity_id
    from public.approval_tasks at
    join public.approval_requests ar on ar.id = at.request_id and ar.status = 'pending'
    left join public.approval_workflow_steps s on s.workflow_id = ar.workflow_id and s.step_order = at.step_order
    where at.status = 'pending' and at.due_at is not null and at.due_at < now()
  loop
    if t.escalate_to_role_id is not null then
      update public.approval_tasks set status = 'escalated' where id = t.id;
      for u in select ur.user_id from public.user_roles ur join public.user_profiles up on up.id = ur.user_id
               where ur.role_id = t.escalate_to_role_id and up.is_active and up.organisation_id = t.organisation_id loop
        insert into public.approval_tasks(request_id, step_order, step_name, approver_user_id, mode)
        values (t.request_id, t.step_order, t.step_name || ' (escalated)', u, 'any');
        perform public.notify(u, 'approvals', 'approval.escalated', jsonb_build_object('title','Escalated: ' || t.title, 'request', t.title), '/approvals', t.entity_type, t.entity_id);
      end loop;
      n := n + 1;
    elsif t.reminded_at is null or t.reminded_at < now() - interval '24 hours' then
      update public.approval_tasks set reminded_at = now() where id = t.id;
      perform public.notify(t.approver_user_id, 'approvals', 'approval.reminder', jsonb_build_object('title','Reminder: ' || t.title, 'request', t.title), '/approvals', t.entity_type, t.entity_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- inbox view for the current user
create view public.my_approval_tasks as
  select at.id as task_id, at.step_order, at.step_name, at.status as task_status, at.created_at as assigned_at, at.due_at,
         at.delegated_from_user_id,
         ar.id as request_id, ar.entity_type, ar.entity_id, ar.title, ar.summary, ar.amount, ar.status as request_status,
         ar.submitted_at, ar.requester_employee_id, public.employee_name(ar.requester_employee_id) as requester_name
  from public.approval_tasks at
  join public.approval_requests ar on ar.id = at.request_id
  where at.approver_user_id = auth.uid();
grant select on public.my_approval_tasks to authenticated;

-- ---------- RLS ----------
alter table public.notification_templates enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.email_outbox enable row level security;
alter table public.approval_workflows enable row level security;
alter table public.approval_workflow_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.approval_tasks enable row level security;
alter table public.approval_delegations enable row level security;

create policy nt_read on public.notification_templates for select to authenticated using (organisation_id is null or organisation_id = public.current_org_id());
create policy nt_write on public.notification_templates for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.manage'))
  with check (organisation_id = public.current_org_id() and public.has_permission('admin.manage'));

create policy notif_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_mark on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy np_own on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy outbox_admin on public.email_outbox for select to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.manage'));

create policy wf_read on public.approval_workflows for select to authenticated using (organisation_id = public.current_org_id());
create policy wf_write on public.approval_workflows for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.workflows'))
  with check (organisation_id = public.current_org_id() and public.has_permission('admin.workflows'));
create policy wfs_read on public.approval_workflow_steps for select to authenticated
  using (exists (select 1 from public.approval_workflows w where w.id = workflow_id and w.organisation_id = public.current_org_id()));
create policy wfs_write on public.approval_workflow_steps for all to authenticated
  using (public.has_permission('admin.workflows') and exists (select 1 from public.approval_workflows w where w.id = workflow_id and w.organisation_id = public.current_org_id()))
  with check (public.has_permission('admin.workflows') and exists (select 1 from public.approval_workflows w where w.id = workflow_id and w.organisation_id = public.current_org_id()));

-- helper avoids mutual recursion between the two policies
create or replace function public.can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.approval_requests r
    where r.id = p_request and r.organisation_id = public.current_org_id() and (
      r.requester_employee_id = public.current_employee_id()
      or exists (select 1 from public.approval_tasks t where t.request_id = r.id and t.approver_user_id = auth.uid())
      or public.has_permission('admin.workflows')))
$$;
create policy ar_read on public.approval_requests for select to authenticated using (public.can_see_request(id));
create policy at_read on public.approval_tasks for select to authenticated
  using (approver_user_id = auth.uid() or public.can_see_request(request_id));

create policy del_own on public.approval_delegations for all to authenticated
  using (organisation_id = public.current_org_id() and (from_user_id = auth.uid() or public.has_permission('admin.workflows')))
  with check (organisation_id = public.current_org_id() and (from_user_id = auth.uid() or public.has_permission('admin.workflows')));
