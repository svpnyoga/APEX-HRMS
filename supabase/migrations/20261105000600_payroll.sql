-- =====================================================================
-- 0006 PAYROLL (internal processing — no outsourcing features)
-- Statutory rates are data (effective-dated rows), never hardcoded.
-- =====================================================================
create table public.salary_components (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  code text not null,
  name text not null,
  component_type text not null check (component_type in ('earning','deduction','employer_contribution')),
  calc_type text not null default 'fixed' check (calc_type in ('fixed','percent_of_gross','percent_of_basic','balancing','statutory','variable')),
  default_value numeric(12,2) not null default 0,
  statutory_code text check (statutory_code in ('PF','ESI','PT','LWF','TDS')),
  is_taxable boolean not null default true,
  prorate boolean not null default true,
  display_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  description text,
  version int not null default 1,
  effective_from date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, name, version)
);

create table public.salary_structure_components (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.salary_structures(id) on delete cascade,
  component_id uuid not null references public.salary_components(id),
  calc_type text check (calc_type in ('fixed','percent_of_gross','percent_of_basic','balancing')),  -- null = component default
  value numeric(12,2) not null default 0,           -- amount (fixed) or percentage
  unique (structure_id, component_id)
);

create table public.employee_salary_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  structure_id uuid not null references public.salary_structures(id),
  monthly_gross numeric(12,2) not null check (monthly_gross >= 0),
  annual_ctc numeric(14,2),
  effective_from date not null,
  effective_to date,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index on public.employee_salary_assignments(employee_id, effective_from desc);
create trigger trg_audit_salary_assign after insert or update or delete on public.employee_salary_assignments for each row execute function public.audit_trigger();

create table public.statutory_configs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  code text not null check (code in ('PF','ESI','LWF','GRATUITY')),
  employee_rate numeric(8,4) not null default 0,     -- percent (PF/ESI) or days numerator (gratuity)
  employer_rate numeric(8,4) not null default 0,     -- percent or divisor (gratuity)
  wage_ceiling numeric(12,2),                         -- PF wage ceiling / gratuity cap
  eligibility_threshold numeric(12,2),                -- ESI gross threshold / gratuity years
  effective_from date not null,
  effective_to date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.statutory_configs(organisation_id, code, effective_from desc);

create table public.professional_tax_slabs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  state text not null,
  min_monthly_gross numeric(12,2) not null,
  max_monthly_gross numeric(12,2),
  monthly_amount numeric(10,2) not null,
  effective_from date not null,
  effective_to date,
  notes text
);

create table public.employee_recurring_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  component_code text not null,                 -- e.g. TDS, CANTEEN
  title text not null,
  monthly_amount numeric(12,2) not null check (monthly_amount >= 0),
  start_month date not null,
  end_month date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.employee_loans (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  loan_type text not null default 'loan' check (loan_type in ('loan','advance')),
  principal numeric(12,2) not null check (principal > 0),
  emi numeric(12,2) not null check (emi > 0),
  start_month date not null,
  outstanding numeric(12,2) not null,
  status text not null default 'active' check (status in ('active','closed','written_off')),
  remarks text,
  created_at timestamptz not null default now()
);

create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('earning','deduction')),
  component_code text not null default 'BONUS',     -- BONUS, INCENTIVE, ARREARS, LEAVE_ENC, RECOVERY...
  title text not null,
  amount numeric(12,2) not null check (amount >= 0),
  effective_month date not null,                    -- first day of month
  status text not null default 'approved' check (status in ('pending','approved','applied','cancelled')),
  payroll_run_id uuid,
  reference_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index on public.payroll_adjustments(organisation_id, effective_month, status);

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  unique (organisation_id, period_month)
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  period_id uuid not null references public.payroll_periods(id),
  run_type text not null default 'regular' check (run_type in ('regular','supplementary')),
  status text not null default 'draft' check (status in ('draft','calculated','submitted','approved','rejected','locked')),
  employee_count int not null default 0,
  total_gross numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  total_net numeric(14,2) not null default 0,
  total_employer_cost numeric(14,2) not null default 0,
  calculated_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  locked_at timestamptz,
  locked_by uuid,
  reopened_count int not null default 0,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index payroll_one_regular_run on public.payroll_runs(period_id) where run_type = 'regular';

create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  assignment_id uuid references public.employee_salary_assignments(id),
  monthly_gross numeric(12,2) not null default 0,
  days_in_period numeric(5,1) not null,
  lop_days numeric(5,1) not null default 0,
  payable_days numeric(5,1) not null,
  overtime_minutes int not null default 0,
  gross_earnings numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  employer_contributions numeric(12,2) not null default 0,
  has_error boolean not null default false,
  remarks text,
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index on public.payroll_entries(employee_id);

create table public.payroll_entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  component_code text not null,
  component_name text not null,
  line_type text not null check (line_type in ('earning','deduction','employer_contribution')),
  amount numeric(12,2) not null,
  basis text,                                    -- human-readable calculation note
  display_order int not null default 100
);
create index on public.payroll_entry_lines(entry_id);

create view public.payroll_deductions as
  select l.* from public.payroll_entry_lines l where l.line_type = 'deduction';

create table public.loan_recoveries (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.employee_loans(id) on delete cascade,
  entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  unique (loan_id, entry_id)
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.payroll_entries(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  period_month date not null,
  payslip_number text not null unique,
  published_at timestamptz not null default now(),
  viewed_at timestamptz
);
create index on public.payslips(employee_id, period_month desc);

create table public.salary_revisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  effective_from date not null,
  current_gross numeric(12,2),
  new_gross numeric(12,2) not null check (new_gross >= 0),
  new_structure_id uuid references public.salary_structures(id),
  revision_type text not null default 'increment' check (revision_type in ('increment','promotion','correction','market')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid,
  created_at timestamptz not null default now()
);

create table public.fnf_settlements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  offboarding_case_id uuid,
  last_working_day date not null,
  pending_salary_days numeric(5,1) not null default 0,
  leave_encash_days numeric(5,1) not null default 0,
  notice_shortfall_days int not null default 0,
  notice_waived boolean not null default false,
  service_years numeric(5,2),
  total_earnings numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_payable numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','approved','paid')),
  paid_on date,
  payment_reference text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id)
);
create table public.fnf_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.fnf_settlements(id) on delete cascade,
  line_type text not null check (line_type in ('earning','deduction')),
  title text not null,
  amount numeric(12,2) not null,
  basis text
);

-- ---------- lock protection ----------
create or replace function public.payroll_guard() returns trigger
language plpgsql as $$
declare v_status text; v_run uuid;
begin
  if current_setting('app.payroll_unlock', true) = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'payroll_entries' then v_run := coalesce(new.run_id, old.run_id);
  else select run_id into v_run from public.payroll_entries where id = coalesce(new.entry_id, old.entry_id); end if;
  select status into v_status from public.payroll_runs where id = v_run;
  if v_status in ('submitted','approved','locked') then
    raise exception 'Payroll run is %; reopen it (with authorisation) before making changes', v_status;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_payroll_entries_guard before insert or update or delete on public.payroll_entries for each row execute function public.payroll_guard();
create trigger trg_payroll_lines_guard before insert or update or delete on public.payroll_entry_lines for each row execute function public.payroll_guard();
create trigger trg_audit_payroll_runs after update on public.payroll_runs for each row execute function public.audit_trigger();

-- ---------- salary calculation ----------
create or replace function public.active_salary_assignment(p_employee uuid, p_date date) returns public.employee_salary_assignments
language sql stable security definer set search_path = public as $$
  select * from public.employee_salary_assignments
  where employee_id = p_employee and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  order by effective_from desc limit 1
$$;

-- full-month (un-prorated) earnings breakdown for an employee from their structure
-- evaluation order: % of gross and fixed -> % of basic -> balancing (special allowance)
create or replace function public.salary_breakdown(p_employee uuid, p_date date)
returns table (component_code text, component_name text, component_type text, amount numeric, prorate boolean, display_order int)
language plpgsql stable security definer set search_path = public as $$
declare a public.employee_salary_assignments; v_basic numeric := 0; v_sum numeric := 0; c record; v_pass int;
begin
  a := public.active_salary_assignment(p_employee, p_date);
  if a.id is null then return; end if;
  for v_pass in 1..3 loop
    for c in
      select sc.code, sc.name, sc.component_type ctype, coalesce(ssc.calc_type, sc.calc_type) calc, coalesce(ssc.value, sc.default_value) val, sc.prorate pr, sc.display_order ord
      from public.salary_structure_components ssc join public.salary_components sc on sc.id = ssc.component_id
      where ssc.structure_id = a.structure_id and sc.is_active and sc.component_type = 'earning'
      order by sc.display_order
    loop
      if v_pass = 1 and c.calc in ('percent_of_gross','fixed') then
        amount := round(case when c.calc = 'fixed' then c.val else a.monthly_gross * c.val / 100 end, 2);
      elsif v_pass = 2 and c.calc = 'percent_of_basic' then
        amount := round(v_basic * c.val / 100, 2);
      elsif v_pass = 3 and c.calc = 'balancing' then
        amount := greatest(0, a.monthly_gross - v_sum);
      else
        continue;
      end if;
      component_code := c.code; component_name := c.name; component_type := c.ctype; prorate := c.pr; display_order := c.ord;
      if c.code = 'BASIC' then v_basic := v_basic + amount; end if;
      v_sum := v_sum + amount;
      return next;
    end loop;
  end loop;
end $$;

create or replace function public.employee_monthly_component(p_employee uuid, p_code text, p_date date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.salary_breakdown(p_employee, p_date) where component_code = p_code
$$;

create or replace function public.statutory_rule(p_org uuid, p_code text, p_date date) returns public.statutory_configs
language sql stable security definer set search_path = public as $$
  select * from public.statutory_configs where organisation_id = p_org and code = p_code and is_active
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  order by effective_from desc limit 1
$$;

-- PUBLIC (payroll.process): create/fetch the run for a month
create or replace function public.create_payroll_run(p_month date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_period uuid; v_run uuid; v_m date := date_trunc('month', p_month)::date;
begin
  if not public.has_permission('payroll.process') then raise exception 'Not authorised' using errcode = '42501'; end if;
  insert into public.payroll_periods(organisation_id, period_month, start_date, end_date)
  values (v_org, v_m, v_m, (v_m + interval '1 month - 1 day')::date)
  on conflict (organisation_id, period_month) do update set status = payroll_periods.status
  returning id into v_period;
  select id into v_run from public.payroll_runs where period_id = v_period and run_type = 'regular';
  if v_run is null then
    insert into public.payroll_runs(organisation_id, period_id, created_by) values (v_org, v_period, auth.uid()) returning id into v_run;
  end if;
  return v_run;
end $$;

-- PUBLIC (payroll.process): calculate every eligible employee using approved attendance & leave
create or replace function public.calculate_payroll_run(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.payroll_runs; pp public.payroll_periods; cs public.company_settings; e record; a public.employee_salary_assignments;
  v_entry uuid; v_days numeric; v_lop numeric; v_payable numeric; v_factor numeric; b record; v_gross numeric; v_ded numeric; v_er numeric;
  v_basic numeric; pf public.statutory_configs; esi public.statutory_configs; v_pfwage numeric; v_amt numeric; v_pt numeric;
  v_ot int; v_hourly numeric; adj record; ln record; rd record; v_count int := 0; v_absent numeric; v_unpaid numeric; v_not_employed numeric;
  bank public.employee_bank_details; d date; v_working numeric;
begin
  if not public.has_permission('payroll.process') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where id = p_run and organisation_id = public.current_org_id() for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if r.status not in ('draft','calculated','rejected') then raise exception 'Run is % and cannot be recalculated', r.status; end if;
  select * into pp from public.payroll_periods where id = r.period_id;
  select * into cs from public.company_settings where organisation_id = r.organisation_id;
  pf := public.statutory_rule(r.organisation_id, 'PF', pp.end_date);
  esi := public.statutory_rule(r.organisation_id, 'ESI', pp.end_date);

  delete from public.payroll_entries where run_id = p_run;

  for e in select * from public.employees where organisation_id = r.organisation_id and deleted_at is null
             and date_of_joining <= pp.end_date and (exit_date is null or exit_date >= pp.start_date)
             and status <> 'onboarding' loop
    a := public.active_salary_assignment(e.id, least(pp.end_date, coalesce(e.exit_date, pp.end_date)));
    if a.id is null then continue; end if;
    select * into bank from public.employee_bank_details where employee_id = e.id;

    -- days in period by LOP basis
    if cs.lop_basis = 'fixed_30' then v_days := 30;
    elsif cs.lop_basis = 'working_days' then
      v_working := 0; d := pp.start_date;
      while d <= pp.end_date loop
        if not public.is_weekly_off(e.id, d) and not public.is_holiday(e.id, d) then v_working := v_working + 1; end if;
        d := d + 1;
      end loop;
      v_days := v_working;
    else v_days := (pp.end_date - pp.start_date + 1); end if;

    -- not employed days (mid-month joiners / leavers)
    v_not_employed := greatest(0, e.date_of_joining - pp.start_date) + greatest(0, pp.end_date - coalesce(e.exit_date, pp.end_date));
    if cs.lop_basis = 'fixed_30' then v_not_employed := round(v_not_employed * 30.0 / (pp.end_date - pp.start_date + 1), 1); end if;
    -- approved unpaid leave
    select coalesce(sum(public.count_leave_days(e.id, greatest(la.start_date, pp.start_date), least(la.end_date, pp.end_date), la.is_half_day)), 0) into v_unpaid
    from public.leave_applications la join public.leave_types lt on lt.id = la.leave_type_id
    where la.employee_id = e.id and la.status = 'approved' and not lt.is_paid
      and la.start_date <= pp.end_date and la.end_date >= pp.start_date;
    -- absences per attendance (only days actually processed)
    v_absent := 0;
    if cs.absent_counts_as_lop then
      select coalesce(sum(case when status = 'absent' then 1 when status = 'half_day' and leave_application_id is null then 0.5 else 0 end), 0) into v_absent
      from public.attendance_records where employee_id = e.id and work_date between pp.start_date and pp.end_date;
    end if;
    v_lop := least(v_days, v_not_employed + v_unpaid + v_absent);
    v_payable := v_days - v_lop;
    v_factor := case when v_days > 0 then v_payable / v_days else 0 end;

    insert into public.payroll_entries(run_id, employee_id, assignment_id, monthly_gross, days_in_period, lop_days, payable_days)
    values (p_run, e.id, a.id, a.monthly_gross, v_days, v_lop, v_payable) returning id into v_entry;

    v_gross := 0; v_ded := 0; v_er := 0; v_basic := 0;
    for b in select * from public.salary_breakdown(e.id, least(pp.end_date, coalesce(e.exit_date, pp.end_date))) loop
      v_amt := round(case when b.prorate then b.amount * v_factor else b.amount end, 0);
      if b.component_code = 'BASIC' then v_basic := v_amt; end if;
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, b.component_code, b.component_name, 'earning', v_amt,
              case when b.prorate and v_factor < 1 then format('%s × %s/%s days', b.amount, v_payable, v_days) end, b.display_order);
      v_gross := v_gross + v_amt;
    end loop;

    -- overtime (approved, unpaid, within period)
    select coalesce(sum(approved_minutes), 0) into v_ot from public.overtime_records
     where employee_id = e.id and status = 'approved' and payroll_run_id is null and work_date <= pp.end_date;
    if v_ot > 0 then
      v_hourly := a.monthly_gross / 30.0 / greatest(1, cs.full_day_min_minutes / 60.0);
      v_amt := round(v_hourly * cs.overtime_rate_multiplier * v_ot / 60.0, 0);
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'OT', 'Overtime', 'earning', v_amt, format('%s h × %s × %s', round(v_ot/60.0,2), round(v_hourly,2), cs.overtime_rate_multiplier), 60);
      v_gross := v_gross + v_amt;
      update public.payroll_entries set overtime_minutes = v_ot where id = v_entry;
    end if;

    -- one-time adjustments: bonuses, incentives, arrears, encashment, recoveries
    for adj in select * from public.payroll_adjustments where employee_id = e.id and status = 'approved'
               and effective_month <= pp.period_month and payroll_run_id is null loop
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, adj.component_code, adj.title, adj.adjustment_type, adj.amount, 'One-time', 70);
      if adj.adjustment_type = 'earning' then v_gross := v_gross + adj.amount; else v_ded := v_ded + adj.amount; end if;
    end loop;

    -- Provident Fund
    if pf.id is not null and coalesce(bank.pf_applicable, true) and v_basic > 0 then
      v_pfwage := case when pf.wage_ceiling is not null then least(v_basic, pf.wage_ceiling) else v_basic end;
      v_amt := round(v_pfwage * pf.employee_rate / 100, 0);
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'PF', 'Provident Fund', 'deduction', v_amt, format('%s%% of %s', pf.employee_rate, v_pfwage), 200);
      v_ded := v_ded + v_amt;
      v_amt := round(v_pfwage * pf.employer_rate / 100, 0);
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'PF_ER', 'Employer PF', 'employer_contribution', v_amt, format('%s%% of %s', pf.employer_rate, v_pfwage), 300);
      v_er := v_er + v_amt;
    end if;

    -- Employee State Insurance (eligibility on full monthly gross)
    if esi.id is not null and coalesce(bank.esi_applicable, true) and a.monthly_gross <= coalesce(esi.eligibility_threshold, 0) then
      v_amt := ceil(v_gross * esi.employee_rate / 100);
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'ESI', 'ESI', 'deduction', v_amt, format('%s%% of %s', esi.employee_rate, v_gross), 210);
      v_ded := v_ded + v_amt;
      v_amt := ceil(v_gross * esi.employer_rate / 100);
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'ESI_ER', 'Employer ESI', 'employer_contribution', v_amt, format('%s%% of %s', esi.employer_rate, v_gross), 310);
      v_er := v_er + v_amt;
    end if;

    -- Professional Tax by state slab
    if coalesce(bank.pt_applicable, true) then
      select monthly_amount into v_pt from public.professional_tax_slabs
       where organisation_id = r.organisation_id and state = coalesce(e.state, cs.payroll_state)
         and v_gross >= min_monthly_gross and (max_monthly_gross is null or v_gross <= max_monthly_gross)
         and effective_from <= pp.end_date and (effective_to is null or effective_to >= pp.end_date)
       order by effective_from desc limit 1;
      if coalesce(v_pt, 0) > 0 then
        insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
        values (v_entry, 'PT', 'Professional Tax', 'deduction', v_pt, coalesce(e.state, cs.payroll_state) || ' slab', 220);
        v_ded := v_ded + v_pt;
      end if;
      v_pt := null;
    end if;

    -- recurring deductions (e.g. TDS as computed by finance)
    for rd in select * from public.employee_recurring_deductions where employee_id = e.id and is_active
              and start_month <= pp.period_month and (end_month is null or end_month >= pp.period_month) loop
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, rd.component_code, rd.title, 'deduction', rd.monthly_amount, 'Recurring', 230);
      v_ded := v_ded + rd.monthly_amount;
    end loop;

    -- loan / advance EMIs
    for ln in select * from public.employee_loans where employee_id = e.id and status = 'active' and outstanding > 0 and start_month <= pp.period_month loop
      v_amt := least(ln.emi, ln.outstanding);
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'LOAN', initcap(ln.loan_type) || ' recovery', 'deduction', v_amt, format('Outstanding %s', ln.outstanding), 240);
      insert into public.loan_recoveries(loan_id, entry_id, amount) values (ln.id, v_entry, v_amt);
      v_ded := v_ded + v_amt;
    end loop;

    update public.payroll_entries set gross_earnings = v_gross, total_deductions = v_ded, net_pay = v_gross - v_ded,
      employer_contributions = v_er, has_error = (v_gross - v_ded) < 0,
      remarks = case when (v_gross - v_ded) < 0 then 'Deductions exceed earnings' end
    where id = v_entry;
    v_count := v_count + 1;
  end loop;

  update public.payroll_runs pr set status = 'calculated', calculated_at = now(),
    employee_count = v_count,
    total_gross = coalesce((select sum(gross_earnings) from public.payroll_entries where run_id = p_run), 0),
    total_deductions = coalesce((select sum(total_deductions) from public.payroll_entries where run_id = p_run), 0),
    total_net = coalesce((select sum(net_pay) from public.payroll_entries where run_id = p_run), 0),
    total_employer_cost = coalesce((select sum(gross_earnings + employer_contributions) from public.payroll_entries where run_id = p_run), 0)
  where id = p_run;
  perform public.log_action('PAYROLL_CALCULATE', 'payroll_runs', p_run::text, v_count || ' employees');
  return jsonb_build_object('employees', v_count);
end $$;

create or replace function public.submit_payroll_run(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.payroll_runs; pp public.payroll_periods;
begin
  if not public.has_permission('payroll.process') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where id = p_run and organisation_id = public.current_org_id() for update;
  if r.status <> 'calculated' then raise exception 'Only calculated runs can be submitted'; end if;
  if exists (select 1 from public.payroll_entries where run_id = p_run and has_error) then raise exception 'Resolve entries with errors before submitting'; end if;
  select * into pp from public.payroll_periods where id = r.period_id;
  update public.payroll_runs set status = 'submitted', submitted_at = now() where id = p_run;
  perform public.submit_for_approval('payroll_run', p_run, public.current_employee_id(),
    'Payroll · ' || to_char(pp.period_month, 'Mon YYYY'), r.employee_count || ' employees, net ' || r.total_net, r.total_net);
end $$;

create or replace function public.approval_hook_payroll_run(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.payroll_runs set status = case when p_status = 'approved' then 'approved' when p_status = 'rejected' then 'rejected' else 'calculated' end,
         approved_at = case when p_status = 'approved' then now() end, notes = coalesce(p_comment, notes)
  where id = p_id;
end $$;

-- PUBLIC (payroll.approve): lock + publish payslips; consumes OT/adjustments/loans
create or replace function public.lock_payroll_run(p_run uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r public.payroll_runs; pp public.payroll_periods; en record; n int := 0;
begin
  if not public.has_permission('payroll.approve') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into r from public.payroll_runs where id = p_run and organisation_id = public.current_org_id() for update;
  if r.status <> 'approved' then raise exception 'Only approved runs can be locked'; end if;
  select * into pp from public.payroll_periods where id = r.period_id;
  update public.overtime_records o set payroll_run_id = p_run from public.payroll_entries pe
   where pe.run_id = p_run and pe.employee_id = o.employee_id and o.status = 'approved' and o.payroll_run_id is null and o.work_date <= pp.end_date;
  update public.payroll_adjustments a set status = 'applied', payroll_run_id = p_run from public.payroll_entries pe
   where pe.run_id = p_run and pe.employee_id = a.employee_id and a.status = 'approved' and a.payroll_run_id is null and a.effective_month <= pp.period_month;
  update public.employee_loans l set outstanding = l.outstanding - lr.amount,
         status = case when l.outstanding - lr.amount <= 0 then 'closed' else l.status end
    from public.loan_recoveries lr join public.payroll_entries pe on pe.id = lr.entry_id
   where lr.loan_id = l.id and pe.run_id = p_run;
  update public.leave_encashments le set status = 'paid' from public.payroll_adjustments a
   where a.id = le.payroll_adjustment_id and a.payroll_run_id = p_run;
  for en in select pe.*, e.user_id, e.employee_code from public.payroll_entries pe join public.employees e on e.id = pe.employee_id where pe.run_id = p_run loop
    insert into public.payslips(entry_id, run_id, employee_id, period_month, payslip_number)
    values (en.id, p_run, en.employee_id, pp.period_month, 'PS-' || to_char(pp.period_month, 'YYYYMM') || '-' || en.employee_code)
    on conflict (entry_id) do nothing;
    perform public.notify(en.user_id, 'payroll', 'payroll.published',
      jsonb_build_object('title', 'Payslip for ' || to_char(pp.period_month, 'Mon YYYY') || ' is ready', 'month', to_char(pp.period_month, 'Mon YYYY')), '/me/payslips');
    n := n + 1;
  end loop;
  update public.payroll_runs set status = 'locked', locked_at = now(), locked_by = auth.uid() where id = p_run;
  update public.payroll_periods set status = 'closed' where id = r.period_id;
  perform public.log_action('PAYROLL_LOCK', 'payroll_runs', p_run::text, n || ' payslips published');
  return n;
end $$;

-- PUBLIC (payroll.manage): reopen a locked/approved run — audited and reverses side effects
create or replace function public.reopen_payroll_run(p_run uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.payroll_runs;
begin
  if not public.has_permission('payroll.manage') then raise exception 'Only payroll administrators can reopen a run' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to reopen payroll'; end if;
  select * into r from public.payroll_runs where id = p_run and organisation_id = public.current_org_id() for update;
  if r.status not in ('approved','locked','submitted') then raise exception 'Run is not locked'; end if;
  perform set_config('app.payroll_unlock', 'on', true);
  if r.status = 'locked' then
    update public.employee_loans l set outstanding = l.outstanding + lr.amount, status = 'active'
      from public.loan_recoveries lr join public.payroll_entries pe on pe.id = lr.entry_id
     where lr.loan_id = l.id and pe.run_id = p_run;
    update public.overtime_records set payroll_run_id = null where payroll_run_id = p_run;
    update public.payroll_adjustments set status = 'approved', payroll_run_id = null where payroll_run_id = p_run;
    delete from public.payslips where run_id = p_run;
  end if;
  update public.approval_requests set status = 'cancelled', completed_at = now() where entity_type = 'payroll_run' and entity_id = p_run and status = 'pending';
  update public.payroll_runs set status = 'calculated', locked_at = null, approved_at = null, reopened_count = reopened_count + 1,
    notes = 'Reopened: ' || p_reason where id = p_run;
  update public.payroll_periods set status = 'open' where id = r.period_id;
  perform set_config('app.payroll_unlock', 'off', true);
  perform public.log_action('PAYROLL_REOPEN', 'payroll_runs', p_run::text, p_reason);
end $$;

-- salary revision -> approval -> new assignment
create or replace function public.request_salary_revision(p_employee uuid, p_effective date, p_new_gross numeric, p_structure uuid, p_type text, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; a public.employee_salary_assignments;
begin
  if not public.has_permission('payroll.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  a := public.active_salary_assignment(p_employee, p_effective);
  insert into public.salary_revisions(organisation_id, employee_id, effective_from, current_gross, new_gross, new_structure_id, revision_type, reason, requested_by)
  values (public.current_org_id(), p_employee, p_effective, a.monthly_gross, p_new_gross, coalesce(p_structure, a.structure_id), coalesce(p_type,'increment'), p_reason, auth.uid())
  returning id into v_id;
  perform public.submit_for_approval('salary_revision', v_id, p_employee,
    'Salary revision · ' || public.employee_name(p_employee), coalesce(a.monthly_gross::text, '—') || ' → ' || p_new_gross || ' from ' || to_char(p_effective,'DD Mon YYYY'), p_new_gross);
  return v_id;
end $$;

create or replace function public.approval_hook_salary_revision(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salary_revisions;
begin
  update public.salary_revisions set status = p_status where id = p_id returning * into s;
  if p_status <> 'approved' then return; end if;
  update public.employee_salary_assignments set effective_to = s.effective_from - 1
   where employee_id = s.employee_id and effective_from < s.effective_from and (effective_to is null or effective_to >= s.effective_from);
  delete from public.employee_salary_assignments where employee_id = s.employee_id and effective_from >= s.effective_from;
  insert into public.employee_salary_assignments(employee_id, structure_id, monthly_gross, annual_ctc, effective_from, remarks)
  values (s.employee_id, s.new_structure_id, s.new_gross, s.new_gross * 12, s.effective_from, 'Revision: ' || s.reason);
  insert into public.employee_employment_history(employee_id, event_type, effective_date, remarks)
  values (s.employee_id, 'salary_revision', s.effective_from, s.revision_type || ': ' || s.reason);
end $$;

-- Full & final computation (draft; finance reviews before approval)
create or replace function public.compute_fnf(p_employee uuid, p_lwd date, p_notice_waived boolean default false, p_case uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.employees; a public.employee_salary_assignments; v_id uuid; v_basic numeric; v_paid_month date; v_days numeric;
  v_el numeric; v_years numeric; g public.statutory_configs; v_grat numeric := 0; v_served int; v_short int := 0; v_loans numeric;
  v_earn numeric := 0; v_ded numeric := 0; v_amt numeric; v_resign date;
begin
  if not public.has_permission('payroll.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into e from public.employees where id = p_employee and organisation_id = public.current_org_id();
  if not found then raise exception 'Employee not found'; end if;
  a := public.active_salary_assignment(p_employee, p_lwd);
  if a.id is null then raise exception 'No salary assignment on the last working day'; end if;
  v_basic := public.employee_monthly_component(p_employee, 'BASIC', p_lwd);

  delete from public.fnf_settlements where employee_id = p_employee and status = 'draft';
  insert into public.fnf_settlements(organisation_id, employee_id, offboarding_case_id, last_working_day, notice_waived)
  values (e.organisation_id, p_employee, p_case, p_lwd, coalesce(p_notice_waived,false)) returning id into v_id;

  -- unpaid salary for the final month (if that month's payroll is not locked)
  select max(pp.period_month) into v_paid_month from public.payroll_entries pe join public.payroll_runs pr on pr.id = pe.run_id
   join public.payroll_periods pp on pp.id = pr.period_id where pe.employee_id = p_employee and pr.status = 'locked';
  if v_paid_month is null or v_paid_month < date_trunc('month', p_lwd)::date then
    v_days := extract(day from p_lwd);
    v_amt := round(a.monthly_gross / extract(day from (date_trunc('month', p_lwd) + interval '1 month - 1 day')) * v_days, 0);
    insert into public.fnf_lines(settlement_id, line_type, title, amount, basis) values (v_id, 'earning', 'Salary for final month', v_amt, v_days || ' days');
    v_earn := v_earn + v_amt;
    update public.fnf_settlements set pending_salary_days = v_days where id = v_id;
  end if;

  -- encashable leave balance
  select coalesce(sum(lb.balance), 0) into v_el from public.leave_balances lb
   join public.leave_policies lp on lp.leave_type_id = lb.leave_type_id and lp.is_active and lp.encashable
   where lb.employee_id = p_employee and lb.leave_year = public.leave_year_of(e.organisation_id, p_lwd) and lb.balance > 0;
  if v_el > 0 then
    v_amt := round(v_basic / 30.0 * v_el, 0);
    insert into public.fnf_lines(settlement_id, line_type, title, amount, basis) values (v_id, 'earning', 'Leave encashment', v_amt, v_el || ' days × basic/30');
    v_earn := v_earn + v_amt;
    update public.fnf_settlements set leave_encash_days = v_el where id = v_id;
  end if;

  -- gratuity per configured rule (e.g. 15/26 × basic × years, after eligibility years)
  v_years := round(((p_lwd - e.date_of_joining) / 365.25)::numeric, 2);
  g := public.statutory_rule(e.organisation_id, 'GRATUITY', p_lwd);
  if g.id is not null and v_years >= coalesce(g.eligibility_threshold, 5) then
    v_grat := round(v_basic * g.employee_rate / nullif(g.employer_rate,0) * round(v_years), 0);
    if g.wage_ceiling is not null then v_grat := least(v_grat, g.wage_ceiling); end if;
    insert into public.fnf_lines(settlement_id, line_type, title, amount, basis)
    values (v_id, 'earning', 'Gratuity', v_grat, format('%s/%s × %s × %s yrs', g.employee_rate, g.employer_rate, v_basic, round(v_years)));
    v_earn := v_earn + v_grat;
  end if;

  -- notice period shortfall
  select resignation_date into v_resign from public.offboarding_cases where id = p_case;
  if v_resign is not null and not coalesce(p_notice_waived, false) then
    v_served := p_lwd - v_resign;
    v_short := greatest(0, e.notice_period_days - v_served);
    if v_short > 0 then
      v_amt := round(a.monthly_gross / 30.0 * v_short, 0);
      insert into public.fnf_lines(settlement_id, line_type, title, amount, basis) values (v_id, 'deduction', 'Notice period shortfall', v_amt, v_short || ' days');
      v_ded := v_ded + v_amt;
    end if;
  end if;

  select coalesce(sum(outstanding), 0) into v_loans from public.employee_loans where employee_id = p_employee and status = 'active';
  if v_loans > 0 then
    insert into public.fnf_lines(settlement_id, line_type, title, amount, basis) values (v_id, 'deduction', 'Outstanding loans/advances', v_loans, null);
    v_ded := v_ded + v_loans;
  end if;

  update public.fnf_settlements set service_years = v_years, notice_shortfall_days = v_short,
    total_earnings = v_earn, total_deductions = v_ded, net_payable = v_earn - v_ded, updated_at = now() where id = v_id;
  return v_id;
end $$;

-- ---------- RLS ----------
alter table public.salary_components enable row level security;
alter table public.salary_structures enable row level security;
alter table public.salary_structure_components enable row level security;
alter table public.employee_salary_assignments enable row level security;
alter table public.statutory_configs enable row level security;
alter table public.professional_tax_slabs enable row level security;
alter table public.employee_recurring_deductions enable row level security;
alter table public.employee_loans enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entry_lines enable row level security;
alter table public.loan_recoveries enable row level security;
alter table public.payslips enable row level security;
alter table public.salary_revisions enable row level security;
alter table public.fnf_settlements enable row level security;
alter table public.fnf_lines enable row level security;

-- configuration: readable by payroll users, writable by payroll admins
do $$
declare t text;
begin
  foreach t in array array['salary_components','salary_structures','statutory_configs','professional_tax_slabs'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (organisation_id = public.current_org_id() and (public.has_permission(''payroll.view'') or public.has_permission(''payroll.manage'')))', t);
    execute format('create policy %1$s_write on public.%1$s for all to authenticated using (organisation_id = public.current_org_id() and public.has_permission(''payroll.manage'')) with check (organisation_id = public.current_org_id())', t);
  end loop;
end $$;

create policy ssc_read on public.salary_structure_components for select to authenticated
  using (public.has_permission('payroll.view') and exists (select 1 from public.salary_structures s where s.id = structure_id and s.organisation_id = public.current_org_id()));
create policy ssc_write on public.salary_structure_components for all to authenticated
  using (public.has_permission('payroll.manage') and exists (select 1 from public.salary_structures s where s.id = structure_id and s.organisation_id = public.current_org_id()))
  with check (public.has_permission('payroll.manage'));

-- salary data is restricted: self + payroll roles (managers do NOT see team salaries)
create policy esa_sal_read on public.employee_salary_assignments for select to authenticated
  using (employee_id = public.current_employee_id() or (public.has_permission('payroll.view') and public.can_view_employee(employee_id, 'payroll')));
create policy esa_sal_write on public.employee_salary_assignments for all to authenticated
  using (public.has_permission('payroll.manage') and public.can_view_employee(employee_id, 'payroll'))
  with check (public.has_permission('payroll.manage'));

create policy erd_read on public.employee_recurring_deductions for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_permission('payroll.view'));
create policy erd_write on public.employee_recurring_deductions for all to authenticated
  using (public.has_permission('payroll.manage')) with check (public.has_permission('payroll.manage'));

create policy loans_read on public.employee_loans for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('payroll.view')));
create policy loans_write on public.employee_loans for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('payroll.manage')) with check (organisation_id = public.current_org_id());

create policy adj_read on public.payroll_adjustments for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('payroll.view')));
create policy adj_write on public.payroll_adjustments for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('payroll.process') and payroll_run_id is null)
  with check (organisation_id = public.current_org_id() and public.has_permission('payroll.process'));

create policy pp_read on public.payroll_periods for select to authenticated using (organisation_id = public.current_org_id());
create policy pr_read on public.payroll_runs for select to authenticated using (organisation_id = public.current_org_id() and public.has_permission('payroll.view'));
create policy pe_read on public.payroll_entries for select to authenticated
  using (public.has_permission('payroll.view') or (employee_id = public.current_employee_id()
         and exists (select 1 from public.payroll_runs r where r.id = run_id and r.status = 'locked')));
create policy pel_read on public.payroll_entry_lines for select to authenticated
  using (exists (select 1 from public.payroll_entries pe where pe.id = entry_id));   -- inherits payroll_entries RLS
create policy lr_read on public.loan_recoveries for select to authenticated using (public.has_permission('payroll.view'));
create policy ps_read on public.payslips for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_permission('payroll.view'));
create policy ps_viewed on public.payslips for update to authenticated
  using (employee_id = public.current_employee_id()) with check (employee_id = public.current_employee_id());
create policy sr_read on public.salary_revisions for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('payroll.view')));
create policy fnf_read on public.fnf_settlements for select to authenticated
  using (organisation_id = public.current_org_id() and (employee_id = public.current_employee_id() or public.has_permission('payroll.view')));
create policy fnf_update on public.fnf_settlements for update to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('payroll.manage')) with check (organisation_id = public.current_org_id());
create policy fnfl_read on public.fnf_lines for select to authenticated
  using (exists (select 1 from public.fnf_settlements s where s.id = settlement_id));
