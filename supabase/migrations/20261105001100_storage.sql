-- =====================================================================
-- 0011 STORAGE BUCKETS (all private) + object policies
-- Path convention: <organisation_id>/<employee_id>/<uuid>-<file name>
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('employee-documents', 'employee-documents', false),
  ('claim-receipts', 'claim-receipts', false),
  ('avatars', 'avatars', false),
  ('learning-content', 'learning-content', false),
  ('announcement-files', 'announcement-files', false)
on conflict (id) do nothing;

create policy "docs read" on storage.objects for select to authenticated using (
  bucket_id = 'employee-documents' and (storage.foldername(name))[1] = public.current_org_id()::text
  and ((storage.foldername(name))[2] = public.current_employee_id()::text
       or (public.has_permission('employees.documents') and public.can_view_employee(((storage.foldername(name))[2])::uuid))));
create policy "docs write" on storage.objects for insert to authenticated with check (
  bucket_id = 'employee-documents' and (storage.foldername(name))[1] = public.current_org_id()::text
  and ((storage.foldername(name))[2] = public.current_employee_id()::text or public.has_permission('employees.documents')));

create policy "receipts read" on storage.objects for select to authenticated using (
  bucket_id = 'claim-receipts' and (storage.foldername(name))[1] = public.current_org_id()::text
  and ((storage.foldername(name))[2] = public.current_employee_id()::text
       or public.has_permission('claims.reimburse')
       or public.can_view_employee(((storage.foldername(name))[2])::uuid, 'claims')));
create policy "receipts write" on storage.objects for insert to authenticated with check (
  bucket_id = 'claim-receipts' and (storage.foldername(name))[1] = public.current_org_id()::text
  and (storage.foldername(name))[2] = public.current_employee_id()::text);
create policy "receipts delete" on storage.objects for delete to authenticated using (
  bucket_id = 'claim-receipts' and (storage.foldername(name))[2] = public.current_employee_id()::text);

create policy "avatars read" on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_org_id()::text);
create policy "avatars write" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_org_id()::text
  and ((storage.foldername(name))[2] = public.current_employee_id()::text or public.has_permission('employees.manage')));
create policy "avatars update" on storage.objects for update to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = public.current_org_id()::text
  and ((storage.foldername(name))[2] = public.current_employee_id()::text or public.has_permission('employees.manage')));

create policy "learning read" on storage.objects for select to authenticated using (
  bucket_id in ('learning-content','announcement-files') and (storage.foldername(name))[1] = public.current_org_id()::text);
create policy "learning write" on storage.objects for insert to authenticated with check (
  (bucket_id = 'learning-content' and public.has_permission('learning.manage') and (storage.foldername(name))[1] = public.current_org_id()::text)
  or (bucket_id = 'announcement-files' and public.has_permission('engagement.manage') and (storage.foldername(name))[1] = public.current_org_id()::text));
