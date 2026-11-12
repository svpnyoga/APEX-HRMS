-- =====================================================================
-- 0002 EMPLOYEES
-- =====================================================================
create sequence public.employee_code_seq start 1001;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  user_id uuid unique references public.user_profiles(id) on delete set null,
  employee_code text not null,
  first_name text not null,
  last_name text not null default '',
  photo_url text,
  official_email text,
  personal_email text,
  mobile text,
  date_of_birth date,
  gender text check (gender in ('male','female','other','undisclosed')),
  marital_status text,
  blood_group text,
  address_line text,
  city text,
  state text,
  postal_code text,
  date_of_joining date not null default current_date,
  confirmation_date date,
  probation_end_date date,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time','part_time','contract','intern','consultant','trainee')),
  department_id uuid references public.departments(id),
  designation_id uuid references public.designations(id),
  reporting_manager_id uuid references public.employees(id),
  location_id uuid references public.locations(id),
  shift_id uuid,                                -- FK added in attendance migration
  is_field_employee boolean not null default false,
  status text not null default 'active'
    check (status in ('onboarding','probation','active','notice','exited','inactive')),
  exit_date date,
  notice_period_days int not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  deleted_at timestamptz,
  unique (organisation_id, employee_code)
);
create index on public.employees(organisation_id, status);
create index on public.employees(reporting_manager_id);
create index on public.employees(department_id);
create trigger trg_employees_updated before update on public.employees for each row execute function public.set_updated_at();
create trigger trg_audit_employees after insert or update or delete on public.employees for each row execute function public.audit_trigger();

alter table public.departments
  add constraint departments_head_fk foreign key (head_employee_id) references public.employees(id) on delete set null;

-- auto employee code: EMP1001, EMP1002 ...
create or replace function public.employees_before_insert() returns trigger
language plpgsql as $$
begin
  if new.employee_code is null or new.employee_code = '' then
    new.employee_code := 'EMP' || nextval('public.employee_code_seq');
  end if;
  return new;
end $$;
create trigger trg_employees_code before insert on public.employees for each row execute function public.employees_before_insert();

create table public.employee_contacts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  name text not null,
  relationship text not null,
  phone text not null,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.employee_contacts(employee_id);

create table public.employee_bank_details (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  bank_name text,
  account_holder text,
  account_number text,
  ifsc text,
  pan text,
  aadhaar_last4 text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  uan text,
  pf_number text,
  esi_number text,
  pf_applicable boolean not null default true,
  esi_applicable boolean not null default true,
  pt_applicable boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger trg_bank_updated before update on public.employee_bank_details for each row execute function public.set_updated_at();
create trigger trg_audit_bank after insert or update or delete on public.employee_bank_details for each row execute function public.audit_trigger();

create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  is_mandatory_onboarding boolean not null default false,
  unique (organisation_id, name)
);

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  document_type_id uuid references public.document_types(id),
  title text not null,
  storage_path text not null,           -- path inside private bucket 'employee-documents'
  file_name text,
  mime_type text,
  size_bytes bigint,
  expiry_date date,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  verified_by uuid,
  verified_at timestamptz,
  remarks text,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.employee_documents(employee_id);
create trigger trg_audit_docs after insert or update or delete on public.employee_documents for each row execute function public.audit_trigger();

create table public.employee_employment_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  event_type text not null check (event_type in ('joined','confirmed','transfer','promotion','department_change','manager_change','location_change','status_change','salary_revision','exit')),
  effective_date date not null default current_date,
  from_department_id uuid references public.departments(id),
  to_department_id uuid references public.departments(id),
  from_designation_id uuid references public.designations(id),
  to_designation_id uuid references public.designations(id),
  from_manager_id uuid references public.employees(id),
  to_manager_id uuid references public.employees(id),
  from_location_id uuid references public.locations(id),
  to_location_id uuid references public.locations(id),
  from_status text,
  to_status text,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.employee_employment_history(employee_id, effective_date desc);

create table public.reporting_relationships (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  manager_id uuid not null references public.employees(id) on delete cascade,
  relationship text not null default 'dotted' check (relationship in ('dotted','functional','project')),
  valid_from date not null default current_date,
  valid_to date,
  unique (employee_id, manager_id, relationship)
);

create table public.employee_assets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  employee_id uuid references public.employees(id) on delete set null,
  asset_tag text not null,
  asset_type text not null,
  description text,
  serial_number text,
  issued_on date,
  expected_return date,
  returned_on date,
  condition_on_return text,
  status text not null default 'issued' check (status in ('available','issued','returned','lost','damaged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, asset_tag)
);
create trigger trg_assets_updated before update on public.employee_assets for each row execute function public.set_updated_at();

-- ---------- hierarchy / access helpers ----------
create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() and deleted_at is null limit 1
$$;

-- true when p_employee reports (directly or indirectly) to p_manager
create or replace function public.is_subordinate(p_employee uuid, p_manager uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, reporting_manager_id, 1 as depth from public.employees where id = p_employee
    union all
    select e.id, e.reporting_manager_id, c.depth + 1
    from public.employees e join chain c on e.id = c.reporting_manager_id
    where c.depth < 20
  )
  select exists (select 1 from chain where reporting_manager_id = p_manager)
$$;

-- central row-scope rule used by almost every RLS policy
-- p_module: the permission module, e.g. 'attendance' -> checks attendance.view / attendance.view_team
create or replace function public.can_view_employee(p_employee uuid, p_module text default 'employees') returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if p_employee is null then return false; end if;
  if p_employee = v_me then return true; end if;
  if not exists (select 1 from public.employees where id = p_employee and organisation_id = public.current_org_id()) then
    return false;
  end if;
  if public.has_permission(p_module || '.view') then return true; end if;
  if v_me is not null and public.has_permission(p_module || '.view_team') and public.is_subordinate(p_employee, v_me) then
    return true;
  end if;
  return false;
end $$;

create or replace function public.employee_user_id(p_employee uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.employees where id = p_employee
$$;

create or replace function public.employee_name(p_employee uuid) returns text
language sql stable security definer set search_path = public as $$
  select trim(first_name || ' ' || last_name) from public.employees where id = p_employee
$$;

-- record transfers / promotions through one audited function
create or replace function public.transfer_employee(
  p_employee uuid, p_event text, p_effective date,
  p_department uuid, p_designation uuid, p_manager uuid, p_location uuid, p_remarks text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.employees;
  v_id uuid;
begin
  if not public.has_permission('employees.manage') then
    raise exception 'Not authorised to transfer employees' using errcode = '42501';
  end if;
  select * into e from public.employees where id = p_employee and organisation_id = public.current_org_id() for update;
  if not found then raise exception 'Employee not found'; end if;
  if p_manager = p_employee then raise exception 'An employee cannot report to themselves'; end if;
  if p_manager is not null and public.is_subordinate(p_manager, p_employee) then
    raise exception 'This would create a circular reporting line';
  end if;

  insert into public.employee_employment_history(employee_id, event_type, effective_date,
    from_department_id, to_department_id, from_designation_id, to_designation_id,
    from_manager_id, to_manager_id, from_location_id, to_location_id, remarks, created_by)
  values (p_employee, coalesce(p_event,'transfer'), coalesce(p_effective, current_date),
    e.department_id, coalesce(p_department, e.department_id),
    e.designation_id, coalesce(p_designation, e.designation_id),
    e.reporting_manager_id, coalesce(p_manager, e.reporting_manager_id),
    e.location_id, coalesce(p_location, e.location_id), p_remarks, auth.uid())
  returning id into v_id;

  update public.employees set
    department_id = coalesce(p_department, department_id),
    designation_id = coalesce(p_designation, designation_id),
    reporting_manager_id = coalesce(p_manager, reporting_manager_id),
    location_id = coalesce(p_location, location_id)
  where id = p_employee;
  return v_id;
end $$;

-- prevent hard deletes of employees with history (statutory retention)
create or replace function public.employees_prevent_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Employees cannot be deleted. Deactivate the employee instead (records are retained for audit).';
end $$;
create trigger trg_employees_no_delete before delete on public.employees for each row execute function public.employees_prevent_delete();

-- ---------- RLS ----------
alter table public.employees enable row level security;
alter table public.employee_contacts enable row level security;
alter table public.employee_bank_details enable row level security;
alter table public.document_types enable row level security;
alter table public.employee_documents enable row level security;
alter table public.employee_employment_history enable row level security;
alter table public.reporting_relationships enable row level security;
alter table public.employee_assets enable row level security;

-- Full employee rows (DOB, personal phone/email, address) only for self, hierarchy, or HR.
-- Everyone in the org can see the safe directory view below.
create policy emp_read on public.employees for select to authenticated
  using (organisation_id = public.current_org_id() and public.can_view_employee(id));
create policy emp_insert on public.employees for insert to authenticated
  with check (organisation_id = public.current_org_id() and public.has_permission('employees.manage'));
create policy emp_update on public.employees for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('employees.manage'))
  with check (organisation_id = public.current_org_id());

create policy contacts_rw on public.employee_contacts for all to authenticated
  using (public.can_view_employee(employee_id) and (employee_id = public.current_employee_id() or public.has_permission('employees.manage') or public.has_permission('employees.view')))
  with check (employee_id = public.current_employee_id() or public.has_permission('employees.manage'));

-- bank & statutory: self (read) + users with employees.sensitive
create policy bank_read on public.employee_bank_details for select to authenticated
  using (employee_id = public.current_employee_id() or (public.has_permission('employees.sensitive') and public.can_view_employee(employee_id)));
create policy bank_write on public.employee_bank_details for all to authenticated
  using (public.has_permission('employees.sensitive') and public.can_view_employee(employee_id))
  with check (public.has_permission('employees.sensitive') and public.can_view_employee(employee_id));

create policy doctypes_read on public.document_types for select to authenticated using (organisation_id = public.current_org_id());
create policy doctypes_write on public.document_types for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('employees.manage'))
  with check (organisation_id = public.current_org_id() and public.has_permission('employees.manage'));

create policy docs_read on public.employee_documents for select to authenticated
  using (deleted_at is null and (employee_id = public.current_employee_id() or (public.has_permission('employees.documents') and public.can_view_employee(employee_id))));
create policy docs_insert on public.employee_documents for insert to authenticated
  with check (employee_id = public.current_employee_id() or public.has_permission('employees.documents'));
create policy docs_update on public.employee_documents for update to authenticated
  using (public.has_permission('employees.documents') and public.can_view_employee(employee_id))
  with check (public.has_permission('employees.documents'));

create policy history_read on public.employee_employment_history for select to authenticated
  using (public.can_view_employee(employee_id));
create policy history_insert on public.employee_employment_history for insert to authenticated
  with check (public.has_permission('employees.manage') and public.can_view_employee(employee_id));

create policy rr_read on public.reporting_relationships for select to authenticated using (public.can_view_employee(employee_id));
create policy rr_write on public.reporting_relationships for all to authenticated
  using (public.has_permission('employees.manage')) with check (public.has_permission('employees.manage'));

create policy assets_read on public.employee_assets for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('onboarding.manage') or public.has_permission('offboarding.manage') or public.has_permission('employees.manage')));
create policy assets_write on public.employee_assets for all to authenticated
  using (organisation_id = public.current_org_id() and (public.has_permission('onboarding.manage') or public.has_permission('offboarding.manage') or public.has_permission('employees.manage')))
  with check (organisation_id = public.current_org_id());

-- Safe, org-wide directory (owner-rights view, filtered to caller's org).
create view public.employee_directory as
  select e.id, e.organisation_id, e.employee_code, e.first_name, e.last_name,
         trim(e.first_name || ' ' || e.last_name) as full_name,
         e.photo_url, e.official_email, e.department_id, d.name as department_name,
         e.designation_id, g.name as designation_name, e.location_id, l.name as location_name,
         e.reporting_manager_id, e.status, e.employment_type, e.date_of_joining, e.is_field_employee,
         to_char(e.date_of_birth, 'MM-DD') as birthday_mmdd, e.user_id
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.designations g on g.id = e.designation_id
  left join public.locations l on l.id = e.location_id
  where e.organisation_id = public.current_org_id() and e.deleted_at is null;
grant select on public.employee_directory to authenticated;
