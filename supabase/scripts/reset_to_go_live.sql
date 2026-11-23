-- =====================================================================================
-- ONE-OFF: clear all test data before going live.            *** CANNOT BE UNDONE ***
-- Run once in the Supabase SQL Editor. Take Admin → Backup → Export first if in doubt.
--
-- Keeps
--   • logins:     the emails in keep_emails below (everyone else's login is deleted)
--   • employees:  the codes in keep_employees (their record, contact/bank details, salary
--                 assignment and shift schedule are kept; their test activity is cleared)
--   • all company setup: settings, departments, designations, locations, shifts, holidays,
--     leave types & policies, salary components & structures, statutory/PT setup, roles &
--     permissions, approval steps, notification templates, claim categories, document types,
--     onboarding templates, rating scales, course categories
--   • the audit log
-- Clears
--   every other employee, and ALL activity: attendance, leave (applications, balances,
--   transactions), payroll runs/payslips, claims, settlements, on/offboarding, appraisals,
--   learning, announcements, surveys, events, recognition, feedback, face data, field visits,
--   sites, approvals, notifications and the email queue.
--
-- Everything runs in one block: if any step fails, nothing at all is changed.
-- Uploaded files (receipts, documents) stay in Storage; delete them under Storage if wanted.
-- =====================================================================================

do $$
declare
  keep_emails    text[] := array['svpnyoga@gmail.com', 'vkvasan.cs@gmail.com'];
  keep_employees text[] := array['EMP1001'];
  t text;
  activity text[] := array[
    'access_requests','announcement_recipients','announcements','policy_acknowledgements',
    'appraisal_finals','appraisal_ratings','appraisal_reviews','appraisal_cycles',
    'performance_feedback','performance_goals','performance_kpis','development_plans',
    'approval_tasks','approval_requests','approval_delegations',
    'assessment_results','assessment_options','assessment_questions','assessments',
    'certificates','lesson_progress','course_enrolments','course_assignments','course_lessons','course_modules','courses','training_sessions',
    'attendance_events','attendance_records','attendance_permissions','attendance_regularisation','overtime_records',
    'face_recognition_attempts','face_templates','face_enrolments','data_consents',
    'field_location_records','field_visits','employee_site_assignments','device_user_mappings',
    'claim_attachments','reimbursements','expense_claims',
    'leave_encashments','leave_transactions','leave_applications','leave_balances',
    'payslips','payroll_entry_lines','payroll_entries','payroll_adjustments','payroll_runs','payroll_periods',
    'loan_recoveries','employee_loans','salary_revisions',
    'fnf_lines','fnf_settlements','clearance_records','exit_interviews','offboarding_tasks','offboarding_cases',
    'onboarding_tasks','onboarding_cases',
    'survey_answers','survey_responses','survey_participation','survey_questions','surveys',
    'event_rsvps','company_events','employee_recognition','employee_feedback',
    'employee_assets','employee_documents','reporting_relationships',
    'notifications','email_outbox','signup_attempts','user_sessions'];
  present text[] := '{}';
  n_users int; n_emps int;
begin
  -- safety: the people to keep must exist, or we stop before touching anything
  if (select count(*) from auth.users where lower(email) = any(keep_emails)) <> array_length(keep_emails, 1) then
    raise exception 'Stopped: not all logins to keep were found (%). Nothing was changed.', keep_emails;
  end if;
  if (select count(*) from public.employees where employee_code = any(keep_employees)) <> array_length(keep_employees, 1) then
    raise exception 'Stopped: not all employees to keep were found (%). Nothing was changed.', keep_employees;
  end if;

  -- 1. all activity, in one statement so links between these tables don't get in the way
  foreach t in array activity loop
    if to_regclass('public.' || t) is not null then present := present || t; end if;
  end loop;
  execute 'truncate table ' || (select string_agg(format('public.%I', x), ', ') from unnest(present) x);

  -- work sites are deleted row by row: per-site geofence settings go with them, company-wide ones stay
  delete from public.attendance_devices;
  delete from public.work_sites;

  -- 2. per-employee details of everyone not kept
  delete from public.attendance_schedules          where employee_id not in (select id from public.employees where employee_code = any(keep_employees));
  delete from public.employee_salary_assignments   where employee_id not in (select id from public.employees where employee_code = any(keep_employees));
  delete from public.employee_recurring_deductions where employee_id not in (select id from public.employees where employee_code = any(keep_employees));
  delete from public.employee_bank_details         where employee_id not in (select id from public.employees where employee_code = any(keep_employees));
  delete from public.employee_contacts             where employee_id not in (select id from public.employees where employee_code = any(keep_employees));
  delete from public.employee_employment_history   where employee_id not in (select id from public.employees where employee_code = any(keep_employees));

  -- 3. the employees themselves (clear manager links to people being removed first)
  update public.employees set reporting_manager_id = null
   where reporting_manager_id in (select id from public.employees where employee_code <> all(keep_employees));
  -- the app normally forbids deleting employees; lift that guard for this cleanup only
  alter table public.employees disable trigger trg_employees_no_delete;
  delete from public.employees where employee_code <> all(keep_employees);
  get diagnostics n_emps = row_count;
  alter table public.employees enable trigger trg_employees_no_delete;

  -- 4. logins of everyone not kept (their profile, roles and preferences go with them).
  --    Files they uploaded stay in Storage but are detached from the login first, since on some
  --    projects a file's owner link would otherwise block deleting the login.
  if to_regclass('storage.objects') is not null then
    begin
      execute $s$update storage.objects set owner = null
                 where owner in (select id from auth.users where lower(email) <> all($1))$s$ using keep_emails;
    exception when others then null;   -- older/newer storage layouts: nothing to detach
    end;
  end if;
  delete from auth.users where lower(email) <> all(keep_emails);
  get diagnostics n_users = row_count;

  raise notice 'Done: % employees and % logins removed; all test activity cleared.', n_emps, n_users;
end $$;

-- what is left
select 'logins' as what, string_agg(email, ', ' order by email) as remaining from auth.users
union all
select 'employees', string_agg(employee_code || ' ' || first_name, ', ' order by employee_code) from public.employees;
