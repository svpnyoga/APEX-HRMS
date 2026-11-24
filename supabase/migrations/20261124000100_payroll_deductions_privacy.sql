-- Privacy fix: the payroll_deductions view ran with its owner's rights, so any signed-in employee could read
-- every employee's deduction lines (PF, ESI, PT, loans, TDS) and work out their salary from them.
-- It now applies the caller's own access rules, exactly like reading payroll_entry_lines directly.
create or replace view public.payroll_deductions with (security_invoker = true) as
  select l.* from public.payroll_entry_lines l where l.line_type = 'deduction';
