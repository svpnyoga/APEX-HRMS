-- Built-in roles (is_system) can't be deleted, and their code / built-in flag can't change: the app looks
-- roles up by code (e.g. HR fallback uses hr_admin / super_admin). Display name and permissions stay editable.
-- Custom roles can be deleted; their assignments are removed with them.

create or replace function public.roles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.signup_bootstrap', true), '') = 'on' or auth.uid() is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and old.is_system then
    raise exception '"%" is a built-in role and cannot be deleted', old.name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.is_system and (new.code is distinct from old.code or new.is_system is distinct from old.is_system or new.organisation_id is distinct from old.organisation_id) then
    raise exception 'The code of built-in role "%" cannot be changed (you can still rename it)', old.name using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.is_system then
    raise exception 'New roles cannot be marked as built-in' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_roles_guard on public.roles;
create trigger trg_roles_guard before insert or update or delete on public.roles
  for each row execute function public.roles_guard();
