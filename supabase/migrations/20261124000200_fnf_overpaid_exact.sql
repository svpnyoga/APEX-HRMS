-- F&F overpaid-salary recovery, made exact: counts the paid days after the last working day the same way
-- payroll counts days (calendar / fixed 30 / working days), excludes LOP that already fell after the LWD,
-- and keeps half days (was rounded to whole days).

-- Paid days after the last working day within a payroll period, in the same units payroll uses
-- (calendar days, fixed 30, or working days per company setting), minus LOP (unpaid leave / absences)
-- that already fell after the LWD and so was never paid.
create or replace function public.fnf_paid_days_after(p_employee uuid, p_lwd date, p_start date, p_end date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare cs public.company_settings; e public.employees; d date; v_from date := greatest(p_start, p_lwd + 1);
        v_days numeric := 0; v_unpaid numeric; v_absent numeric := 0;
begin
  if v_from > p_end then return 0; end if;
  select * into e from public.employees where id = p_employee;
  select * into cs from public.company_settings where organisation_id = e.organisation_id;
  if cs.lop_basis = 'working_days' then
    d := v_from;
    while d <= p_end loop
      if not public.is_weekly_off(p_employee, d) and not public.is_holiday(p_employee, d) then v_days := v_days + 1; end if;
      d := d + 1;
    end loop;
  elsif cs.lop_basis = 'fixed_30' then
    v_days := round((p_end - v_from + 1) * 30.0 / (p_end - p_start + 1), 1);
  else
    v_days := p_end - v_from + 1;
  end if;
  select coalesce(sum(public.count_leave_days(p_employee, greatest(la.start_date, v_from), least(la.end_date, p_end), la.is_half_day)), 0) into v_unpaid
  from public.leave_applications la join public.leave_types lt on lt.id = la.leave_type_id
  where la.employee_id = p_employee and la.status = 'approved' and not lt.is_paid and la.start_date <= p_end and la.end_date >= v_from;
  if cs.absent_counts_as_lop then
    select coalesce(sum(case when status = 'absent' then 1 when status = 'half_day' and leave_application_id is null then 0.5 else 0 end), 0) into v_absent
    from public.attendance_records where employee_id = p_employee and work_date between v_from and p_end;
  end if;
  return greatest(0, v_days - v_unpaid - v_absent);
end $$;

create or replace function public.compute_fnf(p_employee uuid, p_lwd date, p_notice_waived boolean default false, p_case uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.employees; a public.employee_salary_assignments; v_id uuid; v_basic numeric; v_paid_month date; v_days numeric;
  v_el numeric; v_years numeric; g public.statutory_configs; v_grat numeric := 0; v_served int; v_short int := 0; v_loans numeric;
  v_earn numeric := 0; v_ded numeric := 0; v_amt numeric; v_resign date;
  bank public.employee_bank_details; pf public.statutory_configs; esi public.statutory_configs; v_dim numeric; v_basic_pro numeric; v_pfwage numeric; v_pt numeric; v_state text; v_min_years numeric; v_full int; v_pe record; v_over numeric; v_rec numeric;
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
    -- statutory deductions on the final salary, same rules as monthly payroll (it is not paid again by payroll)
    select * into bank from public.employee_bank_details where employee_id = p_employee;
    v_dim := extract(day from (date_trunc('month', p_lwd) + interval '1 month - 1 day'));
    v_basic_pro := round(v_basic / v_dim * v_days, 0);
    pf := public.statutory_rule(e.organisation_id, 'PF', p_lwd);
    if pf.id is not null and coalesce(bank.pf_applicable, true) and v_basic_pro > 0 then
      v_pfwage := case when pf.wage_ceiling is not null then least(v_basic_pro, pf.wage_ceiling) else v_basic_pro end;
      insert into public.fnf_lines(settlement_id, line_type, title, amount, basis)
      values (v_id, 'deduction', 'Provident Fund (final month)', round(v_pfwage * pf.employee_rate / 100, 0), format('%s%% of %s', pf.employee_rate, v_pfwage));
      v_ded := v_ded + round(v_pfwage * pf.employee_rate / 100, 0);
    end if;
    esi := public.statutory_rule(e.organisation_id, 'ESI', p_lwd);
    if esi.id is not null and coalesce(bank.esi_applicable, true) and a.monthly_gross <= coalesce(esi.eligibility_threshold, 0) then
      insert into public.fnf_lines(settlement_id, line_type, title, amount, basis)
      values (v_id, 'deduction', 'ESI (final month)', ceil(v_amt * esi.employee_rate / 100), format('%s%% of %s', esi.employee_rate, v_amt));
      v_ded := v_ded + ceil(v_amt * esi.employee_rate / 100);
    end if;
    if coalesce(bank.pt_applicable, true) then
      select coalesce(e.state, cs.payroll_state) into v_state from public.company_settings cs where cs.organisation_id = e.organisation_id;
      select monthly_amount into v_pt from public.professional_tax_slabs
       where organisation_id = e.organisation_id and state = v_state and v_amt >= min_monthly_gross and (max_monthly_gross is null or v_amt <= max_monthly_gross)
         and effective_from <= p_lwd and (effective_to is null or effective_to >= p_lwd) order by effective_from desc limit 1;
      if coalesce(v_pt, 0) > 0 then
        insert into public.fnf_lines(settlement_id, line_type, title, amount, basis) values (v_id, 'deduction', 'Professional Tax (final month)', v_pt, v_state || ' slab');
        v_ded := v_ded + v_pt;
      end if;
    end if;
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
  -- Code on Social Security 2020 s.53: 5 years (permanent), 1 year for fixed-term (contract) staff;
  -- a part-year of more than six months counts as a full year.
  v_min_years := case when e.employment_type = 'contract' then 1 else coalesce(g.eligibility_threshold, 5) end;
  v_full := floor(v_years)::int + case when v_years - floor(v_years) > 0.5 then 1 else 0 end;
  if g.id is not null and v_years >= v_min_years then
    v_grat := round(v_basic * g.employee_rate / nullif(g.employer_rate,0) * v_full, 0);
    if g.wage_ceiling is not null then v_grat := least(v_grat, g.wage_ceiling); end if;
    insert into public.fnf_lines(settlement_id, line_type, title, amount, basis)
    values (v_id, 'earning', 'Gratuity', v_grat, format('%s/%s × %s × %s yrs', g.employee_rate, g.employer_rate, v_basic, v_full));
    v_earn := v_earn + v_grat;
  end if;

  -- final month (or later months) already paid by a locked payroll: recover the net pay for the paid days
  -- after the LWD, counted exactly the way payroll counts days (LOP after the LWD was already not paid)
  for v_pe in select pe2.net_pay, pe2.payable_days, pp.period_month, pp.start_date, pp.end_date
              from public.payroll_entries pe2
              join public.payroll_runs pr on pr.id = pe2.run_id join public.payroll_periods pp on pp.id = pr.period_id
             where pe2.employee_id = p_employee and pr.status = 'locked' and pp.end_date > p_lwd
               and pe2.payable_days > 0 loop
    v_over := least(v_pe.payable_days, public.fnf_paid_days_after(p_employee, p_lwd, v_pe.start_date, v_pe.end_date));
    if v_over > 0 then
      v_rec := round(v_pe.net_pay * v_over / v_pe.payable_days, 0);
      insert into public.fnf_lines(settlement_id, line_type, title, amount, basis)
      values (v_id, 'deduction', 'Salary paid beyond last working day', v_rec,
              trim_scale(v_over) || ' of ' || trim_scale(v_pe.payable_days) || ' paid days in ' || to_char(v_pe.period_month, 'Mon YYYY') || ' · net pay');
      v_ded := v_ded + v_rec;
    end if;
  end loop;

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

  -- dues recorded during department clearance (unreturned assets, advances ...) are recovered here
  if p_case is not null then
    insert into public.fnf_lines(settlement_id, line_type, title, amount, basis)
    select v_id, 'deduction', 'Clearance dues · ' || case cr.department when 'hr' then 'HR' when 'it' then 'IT' when 'reporting_manager' then 'Reporting manager' else initcap(cr.department) end,
           cr.dues_amount, cr.remarks
    from public.clearance_records cr where cr.case_id = p_case and cr.dues_amount > 0;
    v_ded := v_ded + coalesce((select sum(dues_amount) from public.clearance_records where case_id = p_case and dues_amount > 0), 0);
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
