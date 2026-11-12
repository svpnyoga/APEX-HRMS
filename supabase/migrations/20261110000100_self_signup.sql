-- =====================================================================
-- Self sign-up with administrator approval
--
--   * There are no built-in accounts. The very first person to sign up on a
--     fresh installation creates the company and becomes its super
--     administrator. After that, creating further companies is closed unless
--     the platform operator sets platform_settings.allow_new_organisations.
--   * Everyone else signs up with a secret company code (shown to admins in
--     User management › Sign-up settings), chooses the role they need and
--     waits. An administrator approves (choosing the final roles and the
--     employee record) or rejects with a reason. Until then the account has
--     no profile, so RLS gives it access to nothing.
--   * Email must be confirmed before a request can be made.
--   * Wrong company codes are rate limited (5 per hour per account).
--   * Only a super administrator can grant, remove or deactivate a super
--     administrator, or change the super administrator's permissions; the
--     last active super administrator cannot be removed.
-- =====================================================================

-- ---------- platform switch (operator only; no client access) ----------
create table public.platform_settings (
  id boolean primary key default true check (id),
  allow_new_organisations boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(id) values (true);

-- ---------- company join codes ----------
-- 12 characters from an unambiguous alphabet (no 0/O/1/I), 60 bits of
-- randomness from gen_random_uuid() (a CSPRNG), formatted XXXX-XXXX-XXXX.
create or replace function public.new_join_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  a constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  i int; r text := '';
begin
  -- byte 6 carries the UUID version; byte 8 only its top two bits are fixed
  foreach i in array array[0,1,2,3,4,5,7,8,9,10,11,12] loop
    r := r || substr(a, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return substr(r, 1, 4) || '-' || substr(r, 5, 4) || '-' || substr(r, 9, 4);
end $$;

create table public.signup_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  join_code text not null unique default public.new_join_code(),
  signup_enabled boolean not null default true,
  allowed_email_domains text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create or replace function public.signup_settings_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(array_agg(distinct d order by d), '{}') into new.allowed_email_domains
  from (select lower(btrim(regexp_replace(x, '^\s*@', ''))) d from unnest(coalesce(new.allowed_email_domains, '{}')) x) s
  where d <> '';
  if exists (select 1 from unnest(new.allowed_email_domains) d where d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
    raise exception 'Email domains must look like company.com';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger trg_signup_settings_before before insert or update on public.signup_settings
  for each row execute function public.signup_settings_before();

insert into public.signup_settings(organisation_id) select id from public.organisations on conflict do nothing;

create or replace function public.signup_settings_for_new_org() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.signup_settings(organisation_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger trg_org_signup_settings after insert on public.organisations
  for each row execute function public.signup_settings_for_new_org();

-- ---------- access requests ----------
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email text not null,
  full_name text not null,
  mobile text,
  requested_role text not null,
  job_title text,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.user_profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  granted_roles text[],
  employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.access_requests(organisation_id, status, created_at desc);

create table public.signup_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index on public.signup_attempts(user_id, created_at desc);

-- ---------- RLS & table privileges ----------
alter table public.platform_settings enable row level security;
alter table public.signup_settings enable row level security;
alter table public.access_requests enable row level security;
alter table public.signup_attempts enable row level security;

create policy signup_settings_read on public.signup_settings for select to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.users'));
create policy signup_settings_update on public.signup_settings for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('admin.users'))
  with check (organisation_id = public.current_org_id());

create policy access_requests_read on public.access_requests for select to authenticated
  using (user_id = auth.uid() or (organisation_id = public.current_org_id() and public.has_permission('admin.users')));

revoke all on public.platform_settings from anon, authenticated;
revoke all on public.signup_attempts from anon, authenticated;
revoke all on public.access_requests from anon;
revoke insert, update, delete, truncate on public.access_requests from authenticated;
revoke all on public.signup_settings from anon;
revoke insert, update, delete, truncate on public.signup_settings from authenticated;
grant update (signup_enabled, allowed_email_domains) on public.signup_settings to authenticated;

-- ---------- helpers ----------
create or replace function public.can_create_organisation() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select allow_new_organisations from public.platform_settings where id), false)
      or not exists (select 1 from public.organisations)
$$;

-- What the sign-up screen may offer (callable before signing in).
create or replace function public.signup_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('can_create_organisation', public.can_create_organisation())
$$;

create or replace function public._signup_guard() returns text
language plpgsql security definer set search_path = public as $$
declare v_email text; v_confirmed timestamptz;
begin
  if auth.uid() is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_email is null then raise exception 'Account not found' using errcode = '42501'; end if;
  if v_confirmed is null then raise exception 'Please confirm your email address first' using errcode = '42501'; end if;
  if exists (select 1 from public.user_profiles where id = auth.uid()) then
    raise exception 'Your account is already set up';
  end if;
  return v_email;
end $$;

create or replace function public.my_signup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_email text; v_confirmed timestamptz; r public.access_requests; v_org_name text; v_role_name text;
begin
  if auth.uid() is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  select * into r from public.access_requests where user_id = auth.uid();
  if r.id is not null then
    select name into v_org_name from public.organisations where id = r.organisation_id;
    select name into v_role_name from public.roles where organisation_id = r.organisation_id and code = r.requested_role;
  end if;
  return jsonb_build_object(
    'email', v_email,
    'email_confirmed', v_confirmed is not null,
    'has_profile', exists (select 1 from public.user_profiles where id = auth.uid()),
    'active', coalesce((select is_active from public.user_profiles where id = auth.uid()), false),
    'can_create_organisation', public.can_create_organisation(),
    'request', case when r.id is null then null else jsonb_build_object(
      'id', r.id, 'status', r.status, 'organisation_name', v_org_name,
      'requested_role', r.requested_role, 'requested_role_name', coalesce(v_role_name, r.requested_role),
      'decision_note', r.decision_note, 'created_at', r.created_at, 'decided_at', r.decided_at) end
  );
end $$;

-- ---------- create a company (first sign-up, or when the operator allows it) ----------
create or replace function public.create_organisation_account(
  p_company_name text, p_full_name text, p_mobile text default null, p_city text default null, p_state text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public._signup_guard();
  v_name text := btrim(coalesce(p_full_name, ''));
  v_company text := btrim(coalesce(p_company_name, ''));
  v_org uuid; v_code text; v_emp uuid; v_first text; v_last text;
begin
  if length(v_company) < 2 then raise exception 'Company name is required'; end if;
  if length(v_name) < 2 then raise exception 'Your full name is required'; end if;
  -- serialise concurrent "first sign-ups" so only one can win
  lock table public.organisations in share row exclusive mode;
  if not public.can_create_organisation() then
    raise exception 'Registering a new company is closed. Ask your HR team for your company code and choose "Join my company".' using errcode = '42501';
  end if;
  v_code := upper(left(regexp_replace(v_company, '[^A-Za-z0-9]', '', 'g'), 6));
  if v_code = '' then v_code := 'ORG'; end if;
  v_code := v_code || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));

  perform set_config('app.signup_bootstrap', 'on', true);
  insert into public.organisations(name, code, city, state, email, phone)
  values (v_company, v_code, nullif(btrim(coalesce(p_city, '')), ''), nullif(btrim(coalesce(p_state, '')), ''), v_email, nullif(btrim(coalesce(p_mobile, '')), ''))
  returning id into v_org;
  insert into public.user_profiles(id, organisation_id, email, full_name) values (auth.uid(), v_org, v_email, v_name);
  insert into public.user_roles(user_id, role_id, assigned_by)
  select auth.uid(), id, auth.uid() from public.roles where organisation_id = v_org and code in ('super_admin', 'employee');
  perform set_config('app.signup_bootstrap', 'off', true);

  v_first := split_part(v_name, ' ', 1);
  v_last := btrim(substr(v_name, length(v_first) + 1));
  insert into public.employees(organisation_id, user_id, employee_code, first_name, last_name, official_email, mobile)
  values (v_org, auth.uid(), '', v_first, v_last, v_email, nullif(btrim(coalesce(p_mobile, '')), ''))
  returning id into v_emp;

  insert into public.access_requests(user_id, organisation_id, email, full_name, mobile, requested_role, status,
                                     decided_by, decided_at, decision_note, granted_roles, employee_id)
  values (auth.uid(), v_org, v_email, v_name, p_mobile, 'super_admin', 'approved',
          auth.uid(), now(), 'Company founder', array['super_admin', 'employee'], v_emp)
  on conflict (user_id) do update set organisation_id = excluded.organisation_id, status = 'approved',
    requested_role = 'super_admin', decided_by = excluded.decided_by, decided_at = now(),
    decision_note = excluded.decision_note, granted_roles = excluded.granted_roles, employee_id = excluded.employee_id;

  perform public.log_action('ORG_CREATED', 'organisations', v_org::text, 'Company created by ' || v_email);
  return jsonb_build_object('ok', true, 'organisation_id', v_org, 'employee_id', v_emp);
end $$;

-- ---------- ask to join an existing company ----------
-- Returns {ok:false, error} for a wrong code instead of raising, so the failed
-- attempt is recorded for rate limiting.
create or replace function public.request_access(
  p_join_code text, p_full_name text, p_requested_role text default 'employee',
  p_mobile text default null, p_job_title text default null, p_message text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := public._signup_guard();
  v_name text := btrim(coalesce(p_full_name, ''));
  v_role text := coalesce(nullif(btrim(coalesce(p_requested_role, '')), ''), 'employee');
  v_norm text := upper(regexp_replace(coalesce(p_join_code, ''), '[^A-Za-z0-9]', '', 'g'));
  s public.signup_settings; v_prev text; v_id uuid; v_org_name text; v_role_name text;
begin
  if (select count(*) from public.signup_attempts
       where user_id = auth.uid() and not success and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Too many incorrect company codes. Please try again in an hour.');
  end if;
  if length(v_norm) = 12 then
    select * into s from public.signup_settings where replace(join_code, '-', '') = v_norm;
  end if;
  if s.organisation_id is null then
    insert into public.signup_attempts(user_id, success) values (auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'That company code is not valid. Please check it with your HR team.');
  end if;
  insert into public.signup_attempts(user_id, success) values (auth.uid(), true);

  if not s.signup_enabled then
    return jsonb_build_object('ok', false, 'error', 'This company is not accepting new sign-ups at the moment. Please contact your HR team.');
  end if;
  if cardinality(s.allowed_email_domains) > 0 and not (split_part(v_email, '@', 2) = any (s.allowed_email_domains)) then
    return jsonb_build_object('ok', false, 'error',
      'Please sign up with your work email address (' || array_to_string(array(select '@' || d from unnest(s.allowed_email_domains) d), ', ') || ').');
  end if;
  if length(v_name) < 2 then raise exception 'Your full name is required'; end if;
  select name into v_role_name from public.roles where organisation_id = s.organisation_id and code = v_role;
  if v_role_name is null then raise exception 'Unknown role: %', v_role; end if;

  select status into v_prev from public.access_requests where user_id = auth.uid();
  insert into public.access_requests(user_id, organisation_id, email, full_name, mobile, requested_role, job_title, message, status)
  values (auth.uid(), s.organisation_id, v_email, v_name, nullif(btrim(coalesce(p_mobile, '')), ''), v_role,
          nullif(btrim(coalesce(p_job_title, '')), ''), nullif(left(btrim(coalesce(p_message, '')), 1000), ''), 'pending')
  on conflict (user_id) do update set
    organisation_id = excluded.organisation_id, email = excluded.email, full_name = excluded.full_name,
    mobile = excluded.mobile, requested_role = excluded.requested_role, job_title = excluded.job_title,
    message = excluded.message, status = 'pending', decided_by = null, decided_at = null,
    decision_note = null, granted_roles = null, employee_id = null, created_at = now()
  returning id into v_id;

  select name into v_org_name from public.organisations where id = s.organisation_id;
  -- notify admins once per new / resubmitted request (not on every edit of a pending one)
  if v_prev is distinct from 'pending' then
    perform public.notify_permission(s.organisation_id, 'admin.users', 'general', 'access.requested',
      jsonb_build_object('name', v_name, 'email', v_email, 'role', v_role_name), '/admin/users?tab=requests');
  end if;
  return jsonb_build_object('ok', true, 'request_id', v_id, 'organisation_name', v_org_name);
end $$;

-- ---------- approve / reject ----------
create or replace function public.decide_access_request(
  p_request uuid, p_approve boolean, p_roles text[] default null, p_employee_id uuid default null,
  p_create_employee boolean default true, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_org_id();
  r public.access_requests; v_roles text[]; v_emp uuid; v_first text; v_last text; v_org_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_permission('admin.users') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.access_requests where id = p_request and organisation_id = v_org for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request has already been %', r.status; end if;
  select name into v_org_name from public.organisations where id = v_org;

  if not coalesce(p_approve, false) then
    if v_note is null or length(v_note) < 3 then raise exception 'Please give a reason for rejecting the request'; end if;
    update public.access_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = r.id;
    insert into public.email_outbox(organisation_id, to_email, subject, body)
    values (v_org, r.email, 'Your access request for ' || v_org_name,
            'Hello ' || r.full_name || E',\n\nYour request to join ' || v_org_name || E' was not approved.\nReason: ' || v_note ||
            E'\n\nYou can sign in to correct your details and send a new request.');
    perform public.log_action('ACCESS_REJECTED', 'access_requests', r.id::text, r.email || ': ' || v_note);
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  select array_agg(distinct x order by x) into v_roles
  from unnest(coalesce(p_roles, array[r.requested_role])) x where coalesce(btrim(x), '') <> '';
  if v_roles is null then raise exception 'Choose at least one role'; end if;
  if exists (select 1 from unnest(v_roles) x where not exists (select 1 from public.roles where organisation_id = v_org and code = x)) then
    raise exception 'Unknown role in %', v_roles;
  end if;
  if 'super_admin' = any (v_roles) and not public.has_role('super_admin') then
    raise exception 'Only a super administrator can grant the super administrator role' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_profiles where id = r.user_id) then raise exception 'This person already has an account'; end if;
  if not exists (select 1 from auth.users where id = r.user_id) then raise exception 'This sign-up no longer exists'; end if;

  if p_employee_id is not null then
    select id into v_emp from public.employees where id = p_employee_id and organisation_id = v_org and deleted_at is null for update;
    if v_emp is null then raise exception 'Employee not found'; end if;
    if exists (select 1 from public.employees where id = v_emp and user_id is not null) then raise exception 'This employee already has a login'; end if;
  end if;

  insert into public.user_profiles(id, organisation_id, email, full_name) values (r.user_id, v_org, r.email, r.full_name);
  insert into public.user_roles(user_id, role_id, assigned_by)
  select r.user_id, id, auth.uid() from public.roles where organisation_id = v_org and code = any (v_roles);

  if v_emp is not null then
    update public.employees set user_id = r.user_id,
      is_field_employee = is_field_employee or ('field_employee' = any (v_roles))
    where id = v_emp;
  elsif coalesce(p_create_employee, true) then
    v_first := split_part(r.full_name, ' ', 1);
    v_last := btrim(substr(r.full_name, length(v_first) + 1));
    insert into public.employees(organisation_id, user_id, employee_code, first_name, last_name, official_email, mobile, is_field_employee)
    values (v_org, r.user_id, '', v_first, v_last, r.email, r.mobile, 'field_employee' = any (v_roles))
    returning id into v_emp;
  end if;

  update public.access_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = v_note, granted_roles = v_roles, employee_id = v_emp
  where id = r.id;
  insert into public.email_outbox(organisation_id, to_email, subject, body)
  values (v_org, r.email, 'Welcome to ' || v_org_name,
          'Hello ' || r.full_name || E',\n\nYour access to ' || v_org_name || E' has been approved. You can now sign in.');
  perform public.log_action('ACCESS_APPROVED', 'access_requests', r.id::text, r.email || ' roles=' || array_to_string(v_roles, ','));
  return jsonb_build_object('ok', true, 'status', 'approved', 'employee_id', v_emp);
end $$;

create or replace function public.rotate_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not public.has_permission('admin.users') then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.signup_settings set join_code = public.new_join_code()
  where organisation_id = public.current_org_id() returning join_code into v;
  perform public.log_action('JOIN_CODE_ROTATED', 'signup_settings', public.current_org_id()::text, null);
  return v;
end $$;

-- ---------- guards against privilege escalation ----------
create or replace function public.user_roles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_org uuid;
begin
  if coalesce(current_setting('app.signup_bootstrap', true), '') = 'on' or auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select code into v_code from public.roles where id = new.role_id;
    if v_code = 'super_admin' and not public.has_role('super_admin') then
      raise exception 'Only a super administrator can grant the super administrator role' using errcode = '42501';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select code, organisation_id into v_code, v_org from public.roles where id = old.role_id;
    if v_code = 'super_admin' then
      if not public.has_role('super_admin') then
        raise exception 'Only a super administrator can remove the super administrator role' using errcode = '42501';
      end if;
      if not exists (select 1 from public.user_roles ur join public.user_profiles up on up.id = ur.user_id and up.is_active
                     where ur.role_id = old.role_id and ur.user_id <> old.user_id) then
        raise exception 'You cannot remove the last active super administrator';
      end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_user_roles_guard before insert or update or delete on public.user_roles
  for each row execute function public.user_roles_guard();

create or replace function public.user_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.signup_bootstrap', true), '') = 'on' or auth.uid() is null then return new; end if;
  if new.organisation_id is distinct from old.organisation_id or new.id is distinct from old.id then
    raise exception 'An account cannot be moved to another organisation' using errcode = '42501';
  end if;
  if old.is_active and not new.is_active and exists (
       select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = new.id and r.code = 'super_admin') then
    if not public.has_role('super_admin') then
      raise exception 'Only a super administrator can deactivate a super administrator' using errcode = '42501';
    end if;
    if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id and r.code = 'super_admin'
                   join public.user_profiles up on up.id = ur.user_id and up.is_active
                   where r.organisation_id = new.organisation_id and ur.user_id <> new.id) then
      raise exception 'You cannot deactivate the last active super administrator';
    end if;
  end if;
  return new;
end $$;
create trigger trg_user_profiles_guard before update on public.user_profiles
  for each row execute function public.user_profiles_guard();

create or replace function public.role_permissions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_perm text := coalesce(new.permission_code, old.permission_code);
begin
  if coalesce(current_setting('app.signup_bootstrap', true), '') = 'on' or auth.uid() is null then return coalesce(new, old); end if;
  select code into v_code from public.roles where id = coalesce(new.role_id, old.role_id);
  if (v_perm = '*' or v_code = 'super_admin') and not public.has_role('super_admin') then
    raise exception 'Only a super administrator can change full-access permissions' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function public.role_permissions_guard();

-- ---------- notification template ----------
insert into public.notification_templates(organisation_id, code, title_template, body_template, send_email)
values (null, 'access.requested', 'New access request from {{name}}',
        '{{name}} ({{email}}) has asked to join as {{role}}. Review it in Administration › User management › Access requests.', true);

-- ---------- function privileges ----------
-- Internal helpers: no client access at all.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'new_join_code','can_create_organisation','_signup_guard','signup_settings_before','signup_settings_for_new_org',
             'user_roles_guard','user_profiles_guard','role_permissions_guard')
  loop
    execute format('revoke execute on function %s from public', f.sig);
    begin execute format('revoke execute on function %s from anon, authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
  -- Postgres grants EXECUTE to PUBLIC by default, which includes anon. Move every
  -- client-callable function to an explicit grant for signed-in users only.
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
             and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public', f.sig);
    begin execute format('revoke execute on function %s from anon', f.sig); exception when undefined_object then null; end;
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
-- the only function an anonymous visitor may call
grant execute on function public.signup_options() to anon;
