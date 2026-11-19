-- HR fallback created one approval task per matching ROLE, so a person who is both super_admin and hr_admin
-- got the same request twice. Create one task per person, and remove existing duplicate pending tasks.

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
        -- one task per person, even when they hold several of these roles
        where up.organisation_id = r.organisation_id and up.is_active
          and exists (select 1 from public.user_roles ur join public.roles ro on ro.id = ur.role_id
                      where ur.user_id = up.id and ro.code in ('hr_admin','super_admin'))
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

delete from public.approval_tasks t using public.approval_tasks t2
 where t.request_id = t2.request_id and t.step_order = t2.step_order and t.approver_user_id = t2.approver_user_id
   and t.status = 'pending' and t2.status = 'pending' and t.id > t2.id;
