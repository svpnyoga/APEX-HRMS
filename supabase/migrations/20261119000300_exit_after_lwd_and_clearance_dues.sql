-- 1) "Complete exit" revokes the employee's login; it was allowed before the last working day, cutting access
--    (and attendance) short during the notice period. Now only on or after the last working day.
-- 2) Dues recorded in department clearance were never recovered: the F&F settlement now deducts them.

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

create or replace function public.complete_offboarding(p_case uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.offboarding_cases; v_user uuid;
begin
  if not public.has_permission('offboarding.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select * into c from public.offboarding_cases where id = p_case and organisation_id = public.current_org_id() for update;
  if c.status <> 'in_clearance' then raise exception 'Case is not in clearance'; end if;
  if exists (select 1 from public.clearance_records where case_id = p_case and status <> 'cleared') then raise exception 'All departments must clear the employee first'; end if;
  if exists (select 1 from public.offboarding_tasks where case_id = p_case and is_mandatory and status = 'pending') then raise exception 'Complete all mandatory exit tasks'; end if;
  if exists (select 1 from public.employee_assets where employee_id = c.employee_id and status = 'issued') then raise exception 'Company assets are still issued to this employee'; end if;
  -- completing revokes the login, so it must not happen before the employee's last working day
  if current_date < coalesce(c.approved_lwd, c.requested_lwd) then
    raise exception 'Exit can be completed on or after the last working day (%)', to_char(coalesce(c.approved_lwd, c.requested_lwd), 'DD Mon YYYY');
  end if;
  update public.offboarding_cases set status = 'completed', exit_completed_at = now() where id = p_case;
  update public.employees set status = 'exited', exit_date = coalesce(c.approved_lwd, c.requested_lwd) where id = c.employee_id returning user_id into v_user;
  insert into public.employee_employment_history(employee_id, event_type, effective_date, from_status, to_status, remarks, created_by)
  values (c.employee_id, 'exit', coalesce(c.approved_lwd, c.requested_lwd), 'notice', 'exited', c.separation_type || ': ' || c.reason, auth.uid());
  -- access revocation: profile deactivated (RLS denies everything); auth ban via admin-users edge function
  update public.user_profiles set is_active = false where id = v_user;
  delete from public.user_roles where user_id = v_user;
  perform public.log_action('EXIT_COMPLETE', 'offboarding_cases', p_case::text, 'Access revoked');
end $$;
