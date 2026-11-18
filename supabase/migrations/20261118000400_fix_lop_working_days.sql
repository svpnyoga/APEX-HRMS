-- Payroll LOP with "Working days" basis: days before joining / after exit were counted in calendar days
-- (weekly offs included) but subtracted from a working-day total, underpaying mid-month joiners and leavers.
-- Calendar-days and fixed-30 bases are unchanged.

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
