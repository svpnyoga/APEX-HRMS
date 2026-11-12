-- =====================================================================
-- 0005 LEAVE MANAGEMENT
-- Balances move only through leave_transactions (ledger); approvals via engine.
-- =====================================================================
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  code text not null,
  name text not null,
  is_paid boolean not null default true,
  allow_half_day boolean not null default true,
  allow_negative_balance boolean not null default false,
  requires_balance boolean not null default true,     -- false for unpaid leave
  document_required_after_days numeric(4,1),          -- e.g. sick leave > 2 days
  max_consecutive_days int,
  min_notice_days int not null default 0,
  gender_restriction text check (gender_restriction in ('male','female')),
  color text not null default '#4338CA',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table public.leave_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  name text not null,
  annual_entitlement numeric(5,1) not null default 0 check (annual_entitlement >= 0),
  accrual_frequency text not null default 'monthly' check (accrual_frequency in ('annual','monthly','quarterly','none')),
  carry_forward_max numeric(5,1) not null default 0,
  encashable boolean not null default false,
  encash_max_days numeric(5,1) not null default 0,
  min_service_days int not null default 0,
  employment_types text[] not null default '{full_time,part_time,contract,intern,consultant,trainee}',
  effective_from date not null default date_trunc('year', current_date)::date,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.leave_policies(leave_type_id, effective_from);

create table public.leave_balances (
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  leave_year int not null,
  opening numeric(6,1) not null default 0,
  accrued numeric(6,1) not null default 0,
  used numeric(6,1) not null default 0,
  adjusted numeric(6,1) not null default 0,
  encashed numeric(6,1) not null default 0,
  lapsed numeric(6,1) not null default 0,
  balance numeric(6,1) generated always as (opening + accrued + adjusted - used - encashed - lapsed) stored,
  updated_at timestamptz not null default now(),
  primary key (employee_id, leave_type_id, leave_year)
);

create table public.leave_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  leave_year int not null,
  txn_type text not null check (txn_type in ('opening','accrual','debit','credit','adjustment','encash','lapse','carry_forward')),
  days numeric(6,1) not null,               -- positive number; direction implied by txn_type
  period_key text,                          -- idempotency for accruals, e.g. '2026-11'
  reference_id uuid,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index leave_txn_period_uq on public.leave_transactions(employee_id, leave_type_id, txn_type, period_key) where period_key is not null;
create index on public.leave_transactions(employee_id, leave_year);

create table public.leave_applications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id),
  start_date date not null,
  end_date date not null,
  is_half_day boolean not null default false,
  half_day_session text check (half_day_session in ('first_half','second_half')),
  days numeric(5,1) not null,
  reason text not null,
  document_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  applied_at timestamptz not null default now(),
  decided_at timestamptz,
  decision_comment text,
  cancelled_at timestamptz,
  check (end_date >= start_date),
  check (not is_half_day or start_date = end_date)
);
create index on public.leave_applications(employee_id, start_date);
create index on public.leave_applications(organisation_id, status);

alter table public.attendance_records add constraint att_leave_fk foreign key (leave_application_id) references public.leave_applications(id) on delete set null;

create table public.leave_encashments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id),
  leave_year int not null,
  days numeric(5,1) not null check (days > 0),
  amount numeric(12,2),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','paid')),
  payroll_adjustment_id uuid,
  created_at timestamptz not null default now()
);

-- approval history for leave (engine tasks presented with the spec's table name)
create view public.leave_approvals as
  select t.id, r.entity_id as leave_application_id, t.step_order, t.step_name, t.approver_user_id, t.status, t.comment, t.acted_at, t.created_at
  from public.approval_tasks t join public.approval_requests r on r.id = t.request_id
  where r.entity_type = 'leave' and public.can_see_request(r.id);
grant select on public.leave_approvals to authenticated;

-- ---------- ledger -> balance ----------
create or replace function public.leave_txn_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.leave_balances(employee_id, leave_type_id, leave_year) values (new.employee_id, new.leave_type_id, new.leave_year)
  on conflict do nothing;
  update public.leave_balances set
    opening  = opening  + case when new.txn_type in ('opening','carry_forward') then new.days else 0 end,
    accrued  = accrued  + case when new.txn_type = 'accrual' then new.days else 0 end,
    used     = used     + case when new.txn_type = 'debit' then new.days when new.txn_type = 'credit' then -new.days else 0 end,
    adjusted = adjusted + case when new.txn_type = 'adjustment' then new.days else 0 end,
    encashed = encashed + case when new.txn_type = 'encash' then new.days else 0 end,
    lapsed   = lapsed   + case when new.txn_type = 'lapse' then new.days else 0 end,
    updated_at = now()
  where employee_id = new.employee_id and leave_type_id = new.leave_type_id and leave_year = new.leave_year;
  return new;
end $$;
create trigger trg_leave_txn_apply after insert on public.leave_transactions for each row execute function public.leave_txn_apply();

create or replace function public.leave_txn_immutable() returns trigger language plpgsql as $$
begin raise exception 'Leave ledger entries are immutable; post a correcting adjustment instead'; end $$;
create trigger trg_leave_txn_immutable before update or delete on public.leave_transactions for each row execute function public.leave_txn_immutable();

create or replace function public.leave_year_of(p_org uuid, p_date date) returns int
language sql stable security definer set search_path = public as $$
  select case when extract(month from p_date)::int >= cs.leave_year_start_month
              then extract(year from p_date)::int else extract(year from p_date)::int - 1 end
  from public.company_settings cs where cs.organisation_id = p_org
$$;

-- working-day count for a leave range, per company settings
create or replace function public.count_leave_days(p_employee uuid, p_start date, p_end date, p_half boolean) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare d date; n numeric := 0; cs public.company_settings;
begin
  select c.* into cs from public.company_settings c join public.employees e on e.organisation_id = c.organisation_id where e.id = p_employee;
  if p_half then
    if (not cs.leave_count_weekly_offs and public.is_weekly_off(p_employee, p_start)) or (not cs.leave_count_holidays and public.is_holiday(p_employee, p_start)) then
      return 0;
    end if;
    return 0.5;
  end if;
  d := p_start;
  while d <= p_end loop
    if (cs.leave_count_weekly_offs or not public.is_weekly_off(p_employee, d))
       and (cs.leave_count_holidays or not public.is_holiday(p_employee, d)) then
      n := n + 1;
    end if;
    d := d + 1;
  end loop;
  return n;
end $$;

create or replace function public.leave_available(p_employee uuid, p_type uuid, p_year int) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select balance from public.leave_balances where employee_id = p_employee and leave_type_id = p_type and leave_year = p_year), 0)
       - coalesce((select sum(days) from public.leave_applications la join public.employees e on e.id = la.employee_id
                   where la.employee_id = p_employee and la.leave_type_id = p_type and la.status = 'pending'
                     and public.leave_year_of(e.organisation_id, la.start_date) = p_year), 0)
$$;

-- PUBLIC: apply for leave (self) with every validation server side
create or replace function public.apply_leave(
  p_leave_type uuid, p_start date, p_end date, p_half boolean default false, p_session text default null,
  p_reason text default null, p_document_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees; lt public.leave_types; v_days numeric; v_year int; v_avail numeric; v_id uuid;
begin
  select * into v_emp from public.employees where id = public.current_employee_id();
  if v_emp.id is null then raise exception 'Your login is not linked to an employee record'; end if;
  if not public.has_permission('leave.apply') then raise exception 'Not authorised to apply for leave' using errcode = '42501'; end if;
  select * into lt from public.leave_types where id = p_leave_type and organisation_id = v_emp.organisation_id and is_active;
  if not found then raise exception 'Unknown leave type'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please give a reason'; end if;
  if p_end < p_start then raise exception 'End date is before start date'; end if;
  if p_half and not lt.allow_half_day then raise exception '% cannot be taken as a half day', lt.name; end if;
  if p_half and p_start <> p_end then raise exception 'A half day must start and end on the same date'; end if;
  if p_start < v_emp.date_of_joining then raise exception 'Leave cannot start before your joining date'; end if;
  if lt.gender_restriction is not null and v_emp.gender is distinct from lt.gender_restriction then
    raise exception '% is not applicable to you', lt.name;
  end if;
  if lt.min_notice_days > 0 and p_start < current_date + lt.min_notice_days then
    raise exception '% needs % days notice', lt.name, lt.min_notice_days;
  end if;
  if exists (select 1 from public.leave_applications where employee_id = v_emp.id and status in ('pending','approved')
             and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')
             and not (is_half_day and p_half and half_day_session is distinct from p_session)) then
    raise exception 'You already have leave applied for these dates';
  end if;
  v_days := public.count_leave_days(v_emp.id, p_start, p_end, coalesce(p_half, false));
  if v_days <= 0 then raise exception 'The selected dates are all holidays or weekly offs'; end if;
  if lt.max_consecutive_days is not null and v_days > lt.max_consecutive_days then
    raise exception '% allows at most % consecutive days', lt.name, lt.max_consecutive_days;
  end if;
  if lt.document_required_after_days is not null and v_days > lt.document_required_after_days and p_document_path is null then
    raise exception 'A supporting document is required for % longer than % days', lt.name, lt.document_required_after_days;
  end if;
  v_year := public.leave_year_of(v_emp.organisation_id, p_start);
  if lt.requires_balance and not lt.allow_negative_balance then
    v_avail := public.leave_available(v_emp.id, lt.id, v_year);
    if v_days > v_avail then raise exception 'Insufficient % balance: % available, % requested', lt.name, v_avail, v_days; end if;
  end if;

  insert into public.leave_applications(organisation_id, employee_id, leave_type_id, start_date, end_date, is_half_day, half_day_session, days, reason, document_path)
  values (v_emp.organisation_id, v_emp.id, lt.id, p_start, p_end, coalesce(p_half,false), p_session, v_days, p_reason, p_document_path)
  returning id into v_id;
  perform public.submit_for_approval('leave', v_id, v_emp.id,
    lt.name || ' · ' || v_days || ' day' || case when v_days = 1 then '' else 's' end,
    to_char(p_start, 'DD Mon') || case when p_end <> p_start then ' – ' || to_char(p_end, 'DD Mon YYYY') else ' ' || to_char(p_start,'YYYY') end || ': ' || p_reason);
  return v_id;
end $$;

create or replace function public.approval_hook_leave(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare la public.leave_applications; lt public.leave_types; d date;
begin
  update public.leave_applications set status = p_status, decided_at = now(), decision_comment = p_comment where id = p_id returning * into la;
  if p_status <> 'approved' then return; end if;
  select * into lt from public.leave_types where id = la.leave_type_id;
  if lt.requires_balance then
    insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, reference_id, remarks)
    values (la.employee_id, la.leave_type_id, public.leave_year_of(la.organisation_id, la.start_date), 'debit', la.days, la.id, 'Leave approved');
  end if;
  d := la.start_date;
  while d <= la.end_date loop
    if d <= current_date then perform public.recompute_attendance_day(la.employee_id, d); end if;
    d := d + 1;
  end loop;
end $$;

-- PUBLIC: cancel (pending -> withdraw; approved & future -> reverse ledger)
create or replace function public.cancel_leave(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare la public.leave_applications; lt public.leave_types; d date;
begin
  select * into la from public.leave_applications where id = p_id for update;
  if not found then raise exception 'Leave not found'; end if;
  if la.employee_id <> public.current_employee_id() and not public.has_permission('leave.manage') then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if la.status = 'pending' then
    perform public.cancel_approval('leave', p_id);
    update public.leave_applications set status = 'cancelled', cancelled_at = now() where id = p_id;
  elsif la.status = 'approved' then
    if la.start_date <= current_date and not public.has_permission('leave.manage') then
      raise exception 'Leave that has started can only be cancelled by HR';
    end if;
    select * into lt from public.leave_types where id = la.leave_type_id;
    update public.leave_applications set status = 'cancelled', cancelled_at = now(), decision_comment = coalesce(p_reason, decision_comment) where id = p_id;
    if lt.requires_balance then
      insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, reference_id, remarks, created_by)
      values (la.employee_id, la.leave_type_id, public.leave_year_of(la.organisation_id, la.start_date), 'credit', la.days, la.id, 'Leave cancelled', auth.uid());
    end if;
    d := la.start_date;
    while d <= least(la.end_date, current_date) loop perform public.recompute_attendance_day(la.employee_id, d); d := d + 1; end loop;
  else
    raise exception 'This leave cannot be cancelled';
  end if;
end $$;

-- PUBLIC (HR): manual balance adjustment
create or replace function public.adjust_leave_balance(p_employee uuid, p_type uuid, p_year int, p_days numeric, p_remarks text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('leave.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if coalesce(trim(p_remarks),'') = '' then raise exception 'Remarks are required'; end if;
  if not exists (select 1 from public.employees where id = p_employee and organisation_id = public.current_org_id()) then raise exception 'Employee not found'; end if;
  insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, remarks, created_by)
  values (p_employee, p_type, p_year, 'adjustment', p_days, p_remarks, auth.uid());
end $$;

-- CRON/HR: accrual for a period. Idempotent through period_key.
create or replace function public.run_leave_accrual(p_org uuid, p_as_of date default current_date) returns int
language plpgsql security definer set search_path = public as $$
declare e record; p record; v_days numeric; v_key text; v_year int; n int := 0; v_month int; v_start_month int;
begin
  if auth.uid() is not null and not public.has_permission('leave.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select leave_year_start_month into v_start_month from public.company_settings where organisation_id = p_org;
  v_year := public.leave_year_of(p_org, p_as_of);
  v_month := extract(month from p_as_of)::int;
  for e in select * from public.employees where organisation_id = p_org and status in ('active','probation','notice') and deleted_at is null loop
    for p in select lp.* from public.leave_policies lp where lp.organisation_id = p_org and lp.is_active
               and p_as_of >= lp.effective_from and (lp.effective_to is null or p_as_of <= lp.effective_to)
               and e.employment_type = any(lp.employment_types)
               and p_as_of - e.date_of_joining >= lp.min_service_days loop
      v_days := case p.accrual_frequency
        when 'monthly' then round(p.annual_entitlement / 12.0 * 2) / 2.0          -- rounded to half days
        when 'quarterly' then case when (v_month - v_start_month + 12) % 3 = 0 then round(p.annual_entitlement / 4.0 * 2) / 2.0 else 0 end
        when 'annual' then case when v_month = v_start_month then p.annual_entitlement else 0 end
        else 0 end;
      -- first-year proration for annual grants: grant on joining month too
      if p.accrual_frequency = 'annual' and v_days = 0 and date_trunc('month', e.date_of_joining) = date_trunc('month', p_as_of) then
        v_days := round(p.annual_entitlement * (13 - ((v_month - v_start_month + 12) % 12 + 1)) / 12.0 * 2) / 2.0;
      end if;
      if v_days <= 0 then continue; end if;
      v_key := to_char(p_as_of, 'YYYY-MM');
      insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, period_key, remarks)
      values (e.id, p.leave_type_id, v_year, 'accrual', v_days, v_key, p.name || ' accrual ' || v_key)
      on conflict do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;

-- HR: year-end carry forward + lapse
create or replace function public.close_leave_year(p_org uuid, p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare b record; v_cf numeric; n int := 0;
begin
  if not public.has_permission('leave.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  for b in select lb.*, coalesce(lp.carry_forward_max, 0) cf_max from public.leave_balances lb
           join public.employees e on e.id = lb.employee_id and e.organisation_id = p_org
           left join public.leave_policies lp on lp.leave_type_id = lb.leave_type_id and lp.is_active
           where lb.leave_year = p_year and lb.balance > 0 loop
    v_cf := least(b.balance, b.cf_max);
    if b.balance - v_cf > 0 then
      insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, period_key, remarks)
      values (b.employee_id, b.leave_type_id, p_year, 'lapse', b.balance - v_cf, 'close-' || p_year, 'Year-end lapse') on conflict do nothing;
    end if;
    if v_cf > 0 then
      insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, period_key, remarks)
      values (b.employee_id, b.leave_type_id, p_year + 1, 'carry_forward', v_cf, 'cf-' || p_year, 'Carried forward from ' || p_year) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.request_leave_encashment(p_type uuid, p_days numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_org uuid := public.current_org_id(); lp public.leave_policies; v_year int; v_id uuid;
begin
  if v_emp is null then raise exception 'No employee record'; end if;
  select * into lp from public.leave_policies where leave_type_id = p_type and is_active order by effective_from desc limit 1;
  if not coalesce(lp.encashable, false) then raise exception 'This leave type is not encashable'; end if;
  if p_days > lp.encash_max_days then raise exception 'You can encash at most % days', lp.encash_max_days; end if;
  v_year := public.leave_year_of(v_org, current_date);
  if p_days > public.leave_available(v_emp, p_type, v_year) then raise exception 'Insufficient balance'; end if;
  insert into public.leave_encashments(organisation_id, employee_id, leave_type_id, leave_year, days) values (v_org, v_emp, p_type, v_year, p_days) returning id into v_id;
  perform public.submit_for_approval('leave_encashment', v_id, v_emp, 'Leave encashment · ' || p_days || ' days', null);
  return v_id;
end $$;

create or replace function public.approval_hook_leave_encashment(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare en public.leave_encashments; v_basic numeric; v_amount numeric; v_adj uuid;
begin
  update public.leave_encashments set status = p_status where id = p_id returning * into en;
  if p_status <> 'approved' then return; end if;
  insert into public.leave_transactions(employee_id, leave_type_id, leave_year, txn_type, days, reference_id, remarks)
  values (en.employee_id, en.leave_type_id, en.leave_year, 'encash', en.days, en.id, 'Encashed');
  -- amount = days x (monthly basic / 30); paid through next payroll as a one-time earning
  v_basic := public.employee_monthly_component(en.employee_id, 'BASIC', current_date);
  v_amount := round(coalesce(v_basic, 0) / 30.0 * en.days, 2);
  insert into public.payroll_adjustments(organisation_id, employee_id, adjustment_type, component_code, title, amount, effective_month, status, reference_id)
  values (en.organisation_id, en.employee_id, 'earning', 'LEAVE_ENC', 'Leave encashment ' || en.days || ' days', v_amount, date_trunc('month', current_date)::date, 'approved', en.id)
  returning id into v_adj;
  update public.leave_encashments set amount = v_amount, payroll_adjustment_id = v_adj where id = p_id;
end $$;

-- ---------- RLS ----------
alter table public.leave_types enable row level security;
alter table public.leave_policies enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_transactions enable row level security;
alter table public.leave_applications enable row level security;
alter table public.leave_encashments enable row level security;

create policy lt_read on public.leave_types for select to authenticated using (organisation_id = public.current_org_id());
create policy lt_write on public.leave_types for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('leave.manage')) with check (organisation_id = public.current_org_id());
create policy lp_read on public.leave_policies for select to authenticated using (organisation_id = public.current_org_id());
create policy lp_write on public.leave_policies for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('leave.manage')) with check (organisation_id = public.current_org_id());
create policy lb_read on public.leave_balances for select to authenticated using (public.can_view_employee(employee_id, 'leave'));
create policy ltx_read on public.leave_transactions for select to authenticated using (public.can_view_employee(employee_id, 'leave'));
create policy la_read on public.leave_applications for select to authenticated using (public.can_view_employee(employee_id, 'leave'));
create policy le_read on public.leave_encashments for select to authenticated using (public.can_view_employee(employee_id, 'leave'));
-- writes happen only through SECURITY DEFINER functions above
