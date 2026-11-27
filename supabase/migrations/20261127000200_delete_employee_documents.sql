-- Delete employee documents.
--   * HR (employees.documents permission) can delete any document of an employee they can see, in any status.
--   * An employee can delete their OWN document while it is pending or rejected (not once HR has verified it).
-- The row is kept as deleted (deleted_at) for the audit trail and disappears from every list; the app then
-- removes the file itself from storage, which the new storage policy below allows for the same people.
--
-- UNDO: drop function public.delete_employee_document(uuid); drop policy "docs delete" on storage.objects;

create or replace function public.delete_employee_document(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d public.employee_documents;
begin
  select * into d from public.employee_documents where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Document not found'; end if;
  if not exists (select 1 from public.employees e where e.id = d.employee_id and e.organisation_id = public.current_org_id()) then
    raise exception 'Document not found';
  end if;
  if public.has_permission('employees.documents') and public.can_view_employee(d.employee_id) then
    null;                                                     -- HR: any status
  elsif d.employee_id = public.current_employee_id() then
    if d.verification_status = 'verified' then
      raise exception 'A verified document can only be removed by HR';
    end if;
  else
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.employee_documents set deleted_at = now() where id = p_id;
  return d.storage_path;
end $$;
revoke all on function public.delete_employee_document(uuid) from public, anon;
grant execute on function public.delete_employee_document(uuid) to authenticated;

drop policy if exists "docs delete" on storage.objects;
create policy "docs delete" on storage.objects for delete to authenticated using (
  bucket_id = 'employee-documents' and (storage.foldername(name))[1] = public.current_org_id()::text
  and ((storage.foldername(name))[2] = public.current_employee_id()::text or public.has_permission('employees.documents')));
