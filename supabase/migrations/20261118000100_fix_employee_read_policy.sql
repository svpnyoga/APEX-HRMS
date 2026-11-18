-- Let HR (employees.view) read employee rows directly from the row being checked.
-- can_view_employee() looks the employee up in a snapshot, which cannot see a row being inserted,
-- so INSERT ... RETURNING on employees was rejected by RLS even for admins.
drop policy if exists emp_read on public.employees;
create policy emp_read on public.employees for select to authenticated
  using (organisation_id = public.current_org_id()
         and (public.has_permission('employees.view') or public.can_view_employee(id)));
