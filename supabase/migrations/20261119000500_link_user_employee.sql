-- Link (or unlink) an existing sign-in account to an employee record, so admins who are also employees get their
-- own self-service pages. Before this, linking was only possible when inviting a brand-new user.
create or replace function public.link_user_employee(p_user uuid, p_employee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); e public.employees;
begin
  if not public.has_permission('admin.users') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_profiles where id = p_user and organisation_id = v_org) then raise exception 'User not found'; end if;
  if p_employee is not null then
    select * into e from public.employees where id = p_employee and organisation_id = v_org and deleted_at is null;
    if not found then raise exception 'Employee not found'; end if;
    if e.user_id is not null and e.user_id <> p_user then raise exception 'This employee is already linked to another login'; end if;
  end if;
  update public.employees set user_id = null where user_id = p_user and organisation_id = v_org and id is distinct from p_employee;
  if p_employee is not null then update public.employees set user_id = p_user where id = p_employee; end if;
  perform public.log_action(case when p_employee is null then 'USER_UNLINK_EMPLOYEE' else 'USER_LINK_EMPLOYEE' end,
    'user_profiles', p_user::text, coalesce(p_employee::text, 'unlinked'));
end $$;
revoke all on function public.link_user_employee(uuid, uuid) from public;
grant execute on function public.link_user_employee(uuid, uuid) to authenticated;
