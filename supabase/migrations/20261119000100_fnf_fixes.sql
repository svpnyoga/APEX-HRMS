-- Full & final settlement fixes
-- 1) Double payment: the FnF paid "Salary for final month" when that month's payroll was not locked yet, and the
--    monthly payroll then paid the same days again. Payroll now skips employees whose final month is in an FnF.
-- 2) The FnF final-month salary had no PF / ESI / PT deducted; it now uses the same rules as monthly payroll.
-- 3) Gratuity (Code on Social Security 2020, s.53): fixed-term (contract) employees qualify after 1 year; only a
--    part-year of MORE than six months counts as a full year.

create or replace function public.compute_fnf(p_employee uuid, p_lwd date, p_notice_waived boolean default false, p_case uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e public.employees; a public.employee_salary_assignments; v_id uuid; v_basic numeric; v_paid_month date; v_days numeric;
  v_el numeric; v_years numeric; g public.statutory_configs; v_grat numeric := 0; v_served int; v_short int := 0; v_loans numeric;
  v_earn numeric := 0; v_ded numeric := 0; v_amt numeric; v_resign date;
  bank public.employee_bank_details; pf public.statutory_configs; esi public.statutory_configs; v_dim numeric; v_basic_pro numeric; v_pfwage numeric; v_pt numeric; v_state text; v_min_years numeric; v_full int;
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

create or replace function public.calculate_payroll_run(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.payroll_runs; pp public.payroll_periods; cs public.company_settings; e record; a public.employee_salary_assignments;
  v_entry uuid; v_days numeric; v_lop numeric; v_payable numeric; v_factor numeric; b record; v_gross numeric; v_ded numeric; v_er numeric;
  v_basic numeric; pf public.statutory_configs; esi public.statutory_configs; v_pfwage numeric; v_amt numeric; v_pt numeric;
  v_ot int; v_hourly numeric; adj record; ln record; rd record; v_count int := 0; v_absent numeric; v_unpaid numeric; v_not_employed numeric;
  bank public.employee_bank_details; d date; v_working numeric; v_round numeric;
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
             -- final-month salary already paid through the full & final settlement
             and not exists (select 1 from public.fnf_settlements f where f.employee_id = employees.id and f.pending_salary_days > 0
                             and f.last_working_day between pp.start_date and pp.end_date)
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
    if cs.lop_basis = 'fixed_30' then v_not_employed := round(v_not_employed * 30.0 / (pp.end_date - pp.start_date + 1), 1);
    elsif cs.lop_basis = 'working_days' then
      -- v_days counts working days only, so the days before joining / after exit must be counted the same way
      v_not_employed := 0; d := pp.start_date;
      while d <= pp.end_date loop
        if (d < e.date_of_joining or d > coalesce(e.exit_date, pp.end_date))
           and not public.is_weekly_off(e.id, d) and not public.is_holiday(e.id, d) then v_not_employed := v_not_employed + 1; end if;
        d := d + 1;
      end loop;
    end if;
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

    -- round net pay to the whole rupee with a visible line, so gross - deductions = net still holds on the payslip
    v_round := round(v_gross - v_ded) - (v_gross - v_ded);
    if v_round > 0 then
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'ROUND', 'Rounding off', 'earning', v_round, 'Net pay rounded to the rupee', 95);
      v_gross := v_gross + v_round;
    elsif v_round < 0 then
      insert into public.payroll_entry_lines(entry_id, component_code, component_name, line_type, amount, basis, display_order)
      values (v_entry, 'ROUND', 'Rounding off', 'deduction', -v_round, 'Net pay rounded to the rupee', 250);
      v_ded := v_ded - v_round;
    end if;

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
