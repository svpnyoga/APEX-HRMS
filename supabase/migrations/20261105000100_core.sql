-- =====================================================================
-- 0001 CORE: extensions, organisation, RBAC, audit, helper functions
-- =====================================================================
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------- generic helpers ----------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- organisation ----------
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  code text not null unique,
  logo_url text,
  address text,
  city text,
  state text,
  country text not null default 'India',
  phone text,
  email text,
  website text,
  gstin text,
  pan text,
  tan text,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_organisations_updated before update on public.organisations
  for each row execute function public.set_updated_at();

-- one settings row per organisation; typed columns rather than a JSON blob
create table public.company_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  -- attendance
  reporting_time time not null default '09:30',
  end_time time not null default '18:30',
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  early_departure_minutes int not null default 10 check (early_departure_minutes between 0 and 240),
  half_day_min_minutes int not null default 240,
  full_day_min_minutes int not null default 480,
  overtime_enabled boolean not null default true,
  overtime_min_minutes int not null default 30,
  overtime_rate_multiplier numeric(4,2) not null default 1.5,
  weekly_off_days int[] not null default '{0}',            -- 0=Sunday .. 6=Saturday
  missing_checkout_policy text not null default 'flag' check (missing_checkout_policy in ('flag','half_day','absent')),
  offline_max_age_hours int not null default 72,
  -- face recognition
  face_recognition_enabled boolean not null default true,
  face_required_for_clock boolean not null default true,
  face_match_threshold numeric(4,3) not null default 0.600 check (face_match_threshold between 0.3 and 0.99),
  face_antispoof_threshold numeric(4,3) not null default 0.500,
  face_liveness_threshold numeric(4,3) not null default 0.500,
  face_min_samples int not null default 5 check (face_min_samples between 3 and 10),
  face_max_attempts_per_hour int not null default 10,
  face_provider text not null default 'human-faceres-v1',
  biometric_retention_days int not null default 90,     -- after exit
  recognition_log_retention_days int not null default 365,
  -- gps / field
  gps_mode text not null default 'record' check (gps_mode in ('off','record','flag')),
  location_retention_days int not null default 180,
  tracking_start time not null default '08:00',
  tracking_end time not null default '20:00',
  allow_new_site_entry boolean not null default true,
  -- leave
  leave_year_start_month int not null default 1 check (leave_year_start_month between 1 and 12),
  leave_count_holidays boolean not null default false,
  leave_count_weekly_offs boolean not null default false,
  -- payroll
  payroll_day int not null default 1 check (payroll_day between 1 and 28),
  lop_basis text not null default 'calendar_days' check (lop_basis in ('calendar_days','working_days','fixed_30')),
  absent_counts_as_lop boolean not null default true,
  payroll_state text not null default 'Tamil Nadu',
  -- security
  session_timeout_minutes int not null default 480,
  enforce_mfa_for_admins boolean not null default false,
  -- email
  email_from_name text not null default 'HR Team',
  email_from_address text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger trg_company_settings_updated before update on public.company_settings
  for each row execute function public.set_updated_at();

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);
create trigger trg_locations_updated before update on public.locations for each row execute function public.set_updated_at();

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  code text,
  parent_id uuid references public.departments(id) on delete set null,
  head_employee_id uuid,          -- FK added after employees exists
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organisation_id, name)
);
create trigger trg_departments_updated before update on public.departments for each row execute function public.set_updated_at();

create table public.designations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  level int not null default 1,
  department_id uuid references public.departments(id) on delete set null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organisation_id, name)
);
create trigger trg_designations_updated before update on public.designations for each row execute function public.set_updated_at();

-- ---------- RBAC ----------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade, -- null = system role
  code text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table public.permissions (
  code text primary key,                -- e.g. 'leave.approve'
  module text not null,                 -- e.g. 'leave'
  action text not null check (action in ('view','create','edit','delete','approve','reject','export','manage')),
  scope text not null default 'org' check (scope in ('self','team','org')),
  description text
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

-- user_profiles mirrors auth.users and binds the user to an organisation
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id),
  email text not null,
  full_name text,
  avatar_url text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_user_profiles_updated before update on public.user_profiles for each row execute function public.set_updated_at();

create table public.user_roles (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid,
  primary key (user_id, role_id)
);

create table public.user_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  event text not null check (event in ('login','logout','refresh','failed')),
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);
create index on public.user_sessions(user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organisation_id uuid,
  actor_id uuid,
  action text not null,               -- INSERT/UPDATE/DELETE or domain action
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(organisation_id, created_at desc);
create index on public.audit_logs(table_name, record_id);

-- ---------- identity helpers (SECURITY DEFINER, stable) ----------
create or replace function public.current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organisation_id from public.user_profiles where id = auth.uid()
$$;

create or replace function public.has_permission(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.user_profiles up on up.id = ur.user_id and up.is_active
    where ur.user_id = auth.uid()
      and (rp.permission_code = p_code or rp.permission_code = '*')
  )
$$;

create or replace function public.has_role(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid() and r.code = p_code
  )
$$;

-- generic audit trigger
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_id text;
  v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id := coalesce(v_row->>'id', v_row->>'employee_id', v_row->>'organisation_id');
  begin
    v_org := (v_row->>'organisation_id')::uuid;
  exception when others then v_org := null;
  end;
  insert into public.audit_logs(organisation_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (coalesce(v_org, public.current_org_id()), auth.uid(), tg_op, tg_table_name, v_id,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create or replace function public.log_action(p_action text, p_table text, p_record text, p_note text) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs(organisation_id, actor_id, action, table_name, record_id, note)
  values (public.current_org_id(), auth.uid(), p_action, p_table, p_record, p_note);
$$;

create trigger trg_audit_company_settings after update on public.company_settings for each row execute function public.audit_trigger();
create trigger trg_audit_role_permissions after insert or delete on public.role_permissions for each row execute function public.audit_trigger();
create trigger trg_audit_user_roles after insert or delete on public.user_roles for each row execute function public.audit_trigger();

-- ---------- RLS ----------
alter table public.organisations enable row level security;
alter table public.company_settings enable row level security;
alter table public.locations enable row level security;
alter table public.departments enable row level security;
alter table public.designations enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_sessions enable row level security;
alter table public.audit_logs enable row level security;

create policy org_read on public.organisations for select to authenticated using (id = public.current_org_id());
create policy org_write on public.organisations for update to authenticated
  using (id = public.current_org_id() and public.has_permission('admin.manage'))
  with check (id = public.current_org_id());

create policy settings_read on public.company_settings for select to authenticated using (organisation_id = public.current_org_id());
create policy settings_write on public.company_settings for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.manage'))
  with check (organisation_id = public.current_org_id());

-- master data: readable by everyone in org, writable by HR/admin
do $$
declare t text;
begin
  foreach t in array array['locations','departments','designations'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (organisation_id = public.current_org_id())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (organisation_id = public.current_org_id() and public.has_permission(''employees.manage''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (organisation_id = public.current_org_id() and public.has_permission(''employees.manage'')) with check (organisation_id = public.current_org_id())', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (organisation_id = public.current_org_id() and public.has_permission(''employees.manage''))', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

create policy roles_read on public.roles for select to authenticated using (organisation_id is null or organisation_id = public.current_org_id());
create policy roles_write on public.roles for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.roles'))
  with check (organisation_id = public.current_org_id() and public.has_permission('admin.roles'));

create policy perms_read on public.permissions for select to authenticated using (true);

create policy rp_read on public.role_permissions for select to authenticated using (true);
create policy rp_write on public.role_permissions for all to authenticated
  using (public.has_permission('admin.roles') and exists (select 1 from public.roles r where r.id = role_id and r.organisation_id = public.current_org_id()))
  with check (public.has_permission('admin.roles') and exists (select 1 from public.roles r where r.id = role_id and r.organisation_id = public.current_org_id()));

-- names and work emails are directory information within the organisation
create policy profiles_read on public.user_profiles for select to authenticated
  using (id = auth.uid() or organisation_id = public.current_org_id());
create policy profiles_update_admin on public.user_profiles for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.users'))
  with check (organisation_id = public.current_org_id());

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('admin.users'));
create policy user_roles_write on public.user_roles for all to authenticated
  using (public.has_permission('admin.users') and exists (select 1 from public.user_profiles p where p.id = user_id and p.organisation_id = public.current_org_id()))
  with check (public.has_permission('admin.users') and exists (select 1 from public.user_profiles p where p.id = user_id and p.organisation_id = public.current_org_id()));

create policy sessions_read on public.user_sessions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('admin.audit'));
create policy sessions_insert on public.user_sessions for insert to authenticated with check (user_id = auth.uid());

create policy audit_read on public.audit_logs for select to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.audit'));
-- no insert/update/delete policies: audit rows only come from SECURITY DEFINER code
