-- Approval engine: never ask the same person to approve one request twice.
-- Example: leave workflow = 1) reporting manager, 2) HR. An employee with no manager falls back to HR at
-- step 1, and HR was then asked again at step 2. Now an approver who already approved an earlier step of the
-- same request is skipped; if that leaves a step with nobody, the step counts as approved (create_step_tasks
-- returns -2, which advance_request treats like a skipped conditional step).

create or replace function public.create_step_tasks(p_request uuid, p_step_order int) returns int
language plpgsql security definer set search_path = public as $$
declare
  r public.approval_requests; s public.approval_workflow_steps; u uuid; v_target uuid; n int := 0; v_already int := 0;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into s from public.approval_workflow_steps where workflow_id = r.workflow_id and step_order = p_step_order;
  if not found then return -1; end if;
  if s.min_amount is not null and coalesce(r.amount, 0) < s.min_amount then return 0; end if;
  for u in select distinct x from public.resolve_step_approvers(s, r.requester_employee_id) as x loop
    v_target := public.delegate_for(u, r.entity_type);
    -- requesters never approve their own request
    if v_target = public.employee_user_id(r.requester_employee_id) then continue; end if;
    -- the same person is never asked twice for one request: an earlier approval by them covers this step
    if exists (select 1 from public.approval_tasks t where t.request_id = r.id and t.approver_user_id = v_target and t.status = 'approved') then
      v_already := v_already + 1; continue;
    end if;
    insert into public.approval_tasks(request_id, step_order, step_name, approver_user_id, delegated_from_user_id, mode, due_at)
    values (r.id, s.step_order, s.name, v_target, case when v_target <> u then u end, s.mode,
            case when s.escalate_after_hours is not null then now() + make_interval(hours => s.escalate_after_hours) end);
    perform public.notify(v_target, 'approvals', 'approval.pending',
      jsonb_build_object('title', 'Approval needed: ' || r.title, 'request', r.title,
                         'requester', public.employee_name(r.requester_employee_id), 'step', s.name),
      '/approvals', r.entity_type, r.entity_id);
    n := n + 1;
  end loop;
  if n = 0 and v_already > 0 then return -2; end if;  -- step already satisfied by an earlier approval
  return n;
end $$;

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
          and not exists (select 1 from public.approval_tasks t where t.request_id = r.id and t.approver_user_id = up.id and t.status = 'approved')
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

-- Clean up requests that are already waiting on someone who approved an earlier step.
do $$
declare t record;
begin
  for t in
    select pt.id, pt.request_id, pt.step_order from public.approval_tasks pt
    join public.approval_requests r on r.id = pt.request_id and r.status = 'pending'
    where pt.status = 'pending'
      and exists (select 1 from public.approval_tasks a where a.request_id = pt.request_id
                  and a.approver_user_id = pt.approver_user_id and a.status = 'approved' and a.step_order < pt.step_order)
  loop
    update public.approval_tasks set status = 'approved', comment = 'Auto-approved: already approved at an earlier step', acted_at = now()
     where id = t.id and status = 'pending';
    if not exists (select 1 from public.approval_tasks where request_id = t.request_id and step_order = t.step_order and status = 'pending')
       or exists (select 1 from public.approval_tasks where request_id = t.request_id and step_order = t.step_order and mode = 'any' and status = 'approved') then
      update public.approval_tasks set status = 'skipped' where request_id = t.request_id and step_order = t.step_order and status = 'pending';
      perform public.advance_request(t.request_id, t.step_order + 1);
    end if;
  end loop;
end $$;
