-- An employee can belong to more than one department (e.g. Opto Metrology and NPD).
--
-- employees.department_ids holds ALL of the employee's departments, in the order chosen; the first one is the
-- MAIN department and is kept in employees.department_id. Reports, payroll and headcount keep using the main
-- department, so nobody is counted twice. Announcements, internal messages and training assigned to a department
-- reach everyone who belongs to it, main or not.
--
-- The two columns stay in step automatically:
--   * saving department_ids sets department_id to the first one;
--   * changing only department_id (a transfer) swaps the old main department for the new one in the list.
--
-- UNDO: drop trigger employees_departments_sync on public.employees; drop function public.employees_departments_sync();
--       re-run announcement_visible_to (20261105000800), apply_course_assignment (20261105000900) and
--       employee_directory (20261105000200); alter table public.employees drop column department_ids;

alter table public.employees add column if not exists department_ids uuid[] not null default '{}';
update public.employees set department_ids = array[department_id] where department_id is not null and department_ids = '{}';

create or replace function public.employees_departments_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_bad int;
begin
  if tg_op = 'INSERT' and coalesce(cardinality(new.department_ids), 0) = 0 then
    new.department_ids := case when new.department_id is null then '{}' else array[new.department_id] end;
    return new;
  end if;

  if tg_op = 'INSERT' or new.department_ids is distinct from old.department_ids then
    -- remove blanks and repeats, keep the order
    select coalesce(array_agg(d order by first_pos), '{}') into v_ids
      from (select d, min(pos) first_pos from unnest(coalesce(new.department_ids, '{}')) with ordinality u(d, pos)
            where d is not null group by d) x;
    select count(*) into v_bad from unnest(v_ids) d
     where not exists (select 1 from public.departments dp where dp.id = d and dp.organisation_id = new.organisation_id and dp.deleted_at is null);
    if v_bad > 0 then raise exception 'Unknown department selected'; end if;
    new.department_ids := v_ids;
    new.department_id := v_ids[1];
  elsif new.department_id is distinct from old.department_id then
    -- the main department changed on its own (e.g. a transfer): replace the old main one in the list
    v_ids := array_remove(array_remove(coalesce(old.department_ids, '{}'), old.department_id), new.department_id);
    new.department_ids := case when new.department_id is null then v_ids else array[new.department_id] || v_ids end;
  end if;
  return new;
end $$;

drop trigger if exists employees_departments_sync on public.employees;
create trigger employees_departments_sync before insert or update of department_id, department_ids on public.employees
  for each row execute function public.employees_departments_sync();

-- department notices reach every member, not only those whose main department it is
create or replace function public.announcement_visible_to(a public.announcements, p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a.status = 'published' and a.publish_at <= now() and (a.expires_at is null or a.expires_at > now())
     and (a.audience = 'all'
       or (a.audience = 'department' and exists (select 1 from public.employees e where e.id = p_employee and a.department_id = any(e.department_ids)))
       or (a.audience = 'location' and a.location_id = (select location_id from public.employees where id = p_employee)))
$$;

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
      and (ca.target_type = 'all' or (ca.target_type = 'department' and ca.department_id = any(e.department_ids))
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

-- the directory also lists every department of a person (new columns go at the end)
create or replace view public.employee_directory as
  select e.id, e.organisation_id, e.employee_code, e.first_name, e.last_name,
         trim(e.first_name || ' ' || e.last_name) as full_name,
         e.photo_url, e.official_email, e.department_id, d.name as department_name,
         e.designation_id, g.name as designation_name, e.location_id, l.name as location_name,
         e.reporting_manager_id, e.status, e.employment_type, e.date_of_joining, e.is_field_employee,
         to_char(e.date_of_birth, 'MM-DD') as birthday_mmdd, e.user_id,
         e.department_ids,
         (select string_agg(dp.name, ', ' order by u.pos) from unnest(e.department_ids) with ordinality u(id, pos)
            join public.departments dp on dp.id = u.id) as department_names
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.designations g on g.id = e.designation_id
  left join public.locations l on l.id = e.location_id
  where e.organisation_id = public.current_org_id() and e.deleted_at is null;
grant select on public.employee_directory to authenticated;
