-- =====================================================================
-- 0010 PERMISSIONS CATALOGUE, ORG BOOTSTRAP, DASHBOARDS, REPORT VIEWS,
--      SCHEDULED JOBS, FUNCTION GRANTS
-- =====================================================================

-- ---------- permission catalogue (system data) ----------
insert into public.permissions(code, module, action, scope, description) values
 ('*','admin','manage','org','Everything (super administrator)'),
 ('dashboard.view','dashboard','view','org','HR dashboards'),
 ('dashboard.analytics','dashboard','view','org','Management analytics'),
 ('employees.view','employees','view','org','View all employee records'),
 ('employees.view_team','employees','view','team','View employees in reporting line'),
 ('employees.manage','employees','edit','org','Create, edit, transfer, deactivate employees; master data'),
 ('employees.sensitive','employees','view','org','Bank & statutory details'),
 ('employees.documents','employees','edit','org','Employee documents & verification'),
 ('employees.export','employees','export','org','Export employee data'),
 ('attendance.clock','attendance','create','self','Record own attendance'),
 ('attendance.view','attendance','view','org','View all attendance'),
 ('attendance.view_team','attendance','view','team','View team attendance, approve team overtime'),
 ('attendance.manage','attendance','edit','org','Manual attendance, regularise, shifts, holidays, rules'),
 ('attendance.face_enrol','attendance','manage','org','Enrol / revoke employee faces, view recognition logs'),
 ('attendance.devices','attendance','manage','org','Manage biometric devices'),
 ('attendance.kiosk','attendance','create','org','Shared kiosk: identify any employee by face'),
 ('leave.apply','leave','create','self','Apply for own leave'),
 ('leave.view','leave','view','org','View all leave'),
 ('leave.view_team','leave','view','team','View team leave'),
 ('leave.manage','leave','manage','org','Leave types, policies, balances, accrual'),
 ('payroll.view','payroll','view','org','View payroll data'),
 ('payroll.process','payroll','create','org','Run payroll calculations, adjustments'),
 ('payroll.approve','payroll','approve','org','Lock & publish approved payroll'),
 ('payroll.manage','payroll','manage','org','Salary structures, statutory config, revisions, reopen, F&F'),
 ('claims.submit','claims','create','self','Submit own claims'),
 ('claims.view','claims','view','org','View all claims'),
 ('claims.view_team','claims','view','team','View team claims'),
 ('claims.reimburse','claims','approve','org','Process reimbursements'),
 ('claims.manage','claims','manage','org','Claim categories & expense policies'),
 ('performance.view','performance','view','org','View all appraisals'),
 ('performance.view_team','performance','view','team','View and review team performance'),
 ('performance.manage','performance','manage','org','Cycles, KPIs, rating scales, HR review'),
 ('engagement.manage','engagement','manage','org','Announcements, surveys, events, feedback responses'),
 ('field.view','field','view','org','View field staff locations & visits'),
 ('field.view_team','field','view','team','View team field locations'),
 ('field.manage','field','manage','org','Sites, geofences, assignments'),
 ('onboarding.view','onboarding','view','org','View onboarding'),
 ('onboarding.manage','onboarding','manage','org','Run onboarding'),
 ('offboarding.view','offboarding','view','org','View offboarding'),
 ('offboarding.manage','offboarding','manage','org','Run offboarding & clearance'),
 ('learning.view','learning','view','org','View all learning progress'),
 ('learning.view_team','learning','view','team','View team learning'),
 ('learning.manage','learning','manage','org','Courses, assessments, assignments'),
 ('reports.view','reports','view','org','Reports'),
 ('reports.export','reports','export','org','Export reports'),
 ('admin.manage','admin','manage','org','Organisation settings & configuration'),
 ('admin.users','admin','manage','org','Users & role assignment'),
 ('admin.roles','admin','manage','org','Roles & permissions'),
 ('admin.audit','admin','view','org','Audit logs'),
 ('admin.workflows','admin','manage','org','Approval workflows')
on conflict (code) do nothing;

-- ---------- organisation bootstrap: roles, settings, workflows, templates ----------
create or replace function public.bootstrap_organisation(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role uuid; r record; v_wf uuid; v_hr uuid; v_fin uuid; v_mgmt uuid; v_scale uuid;
begin
  insert into public.company_settings(organisation_id) values (p_org) on conflict do nothing;

  for r in select * from (values
    ('super_admin','Super Administrator','Full access', array['*']),
    ('hr_admin','HR Administrator','Runs HR operations and configuration',
       array['dashboard.view','dashboard.analytics','employees.view','employees.manage','employees.sensitive','employees.documents','employees.export',
             'attendance.clock','attendance.view','attendance.manage','attendance.face_enrol','attendance.devices','leave.apply','leave.view','leave.manage',
             'payroll.view','claims.submit','claims.view','claims.manage','performance.view','performance.manage','engagement.manage',
             'field.view','field.manage','onboarding.view','onboarding.manage','offboarding.view','offboarding.manage',
             'learning.view','learning.manage','reports.view','reports.export','admin.manage','admin.users','admin.roles','admin.audit','admin.workflows']),
    ('hr_executive','HR Executive','Day-to-day HR operations',
       array['dashboard.view','employees.view','employees.manage','employees.documents','attendance.clock','attendance.view','attendance.manage',
             'attendance.face_enrol','leave.apply','leave.view','claims.submit','claims.view','performance.view','engagement.manage',
             'field.view','onboarding.view','onboarding.manage','offboarding.view','offboarding.manage','learning.view','learning.manage','reports.view','reports.export']),
    ('dept_manager','Department Manager','Manages a department',
       array['dashboard.view','employees.view_team','attendance.clock','attendance.view_team','leave.apply','leave.view_team','claims.submit','claims.view_team',
             'performance.view_team','field.view_team','learning.view_team','reports.view']),
    ('team_leader','Team Leader','Leads a team',
       array['employees.view_team','attendance.clock','attendance.view_team','leave.apply','leave.view_team','claims.submit','claims.view_team',
             'performance.view_team','learning.view_team']),
    ('finance_admin','Finance / Payroll Administrator','Payroll and reimbursements',
       array['dashboard.view','employees.view','employees.sensitive','attendance.clock','attendance.view','leave.apply','leave.view',
             'payroll.view','payroll.process','payroll.approve','payroll.manage','claims.submit','claims.view','claims.reimburse','reports.view','reports.export']),
    ('employee','Employee','Self-service',
       array['attendance.clock','leave.apply','claims.submit']),
    ('field_employee','Field Employee','Self-service with site attendance & tracking',
       array['attendance.clock','leave.apply','claims.submit']),
    ('management','Management (read-only)','Organisation-wide read access to reports',
       array['dashboard.view','dashboard.analytics','employees.view','attendance.view','leave.view','claims.view','performance.view','field.view',
             'onboarding.view','offboarding.view','learning.view','reports.view','reports.export']),
    ('kiosk','Attendance Kiosk','Shared face-recognition terminal account', array['attendance.kiosk'])
  ) as t(code, name, descr, perms) loop
    insert into public.roles(organisation_id, code, name, description, is_system) values (p_org, r.code, r.name, r.descr, true)
    on conflict (organisation_id, code) do update set name = excluded.name returning id into v_role;
    insert into public.role_permissions(role_id, permission_code) select v_role, unnest(r.perms) on conflict do nothing;
  end loop;

  select id into v_hr from public.roles where organisation_id = p_org and code = 'hr_admin';
  select id into v_fin from public.roles where organisation_id = p_org and code = 'finance_admin';
  select id into v_mgmt from public.roles where organisation_id = p_org and code = 'super_admin';

  -- default workflows (editable in Administration > Approval Configuration)
  for r in select * from (values
    ('leave','Leave approval'), ('attendance_regularisation','Attendance regularisation'), ('attendance_permission','Permission request'),
    ('expense_claim','Expense claim approval'), ('payroll_run','Payroll approval'), ('salary_revision','Salary revision'),
    ('leave_encashment','Leave encashment'), ('appraisal','Appraisal result'), ('onboarding','Onboarding sign-off'), ('resignation','Resignation approval')
  ) as t(et, nm) loop
    insert into public.approval_workflows(organisation_id, entity_type, name) values (p_org, r.et, r.nm)
    on conflict (organisation_id, entity_type) do nothing returning id into v_wf;
    if v_wf is null then continue; end if;
    if r.et in ('leave','attendance_regularisation','attendance_permission','resignation') then
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, escalate_after_hours, escalate_to_role_id)
      values (v_wf, 1, 'Reporting manager', 'reporting_manager', 48, v_hr);
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, role_id)
      values (v_wf, 2, 'HR', 'role', v_hr);
    elsif r.et = 'expense_claim' then
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, escalate_after_hours, escalate_to_role_id) values (v_wf, 1, 'Reporting manager', 'reporting_manager', 72, v_hr);
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, role_id) values (v_wf, 2, 'Finance verification', 'role', v_fin);
    elsif r.et in ('payroll_run','salary_revision') then
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, role_id) values (v_wf, 1, 'HR review', 'role', v_hr);
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, role_id) values (v_wf, 2, 'Final approval', 'role', v_mgmt);
    elsif r.et = 'leave_encashment' then
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type) values (v_wf, 1, 'Reporting manager', 'reporting_manager');
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, role_id) values (v_wf, 2, 'Finance', 'role', v_fin);
    else
      insert into public.approval_workflow_steps(workflow_id, step_order, name, approver_type, role_id) values (v_wf, 1, 'HR', 'role', v_hr);
    end if;
    v_wf := null;
  end loop;

  insert into public.rating_scales(organisation_id, name, is_default) values (p_org, 'Five point', true) on conflict do nothing returning id into v_scale;
  if v_scale is not null then
    insert into public.rating_scale_levels(scale_id, value, label) values
      (v_scale, 1, 'Needs improvement'), (v_scale, 2, 'Below expectations'), (v_scale, 3, 'Meets expectations'),
      (v_scale, 4, 'Exceeds expectations'), (v_scale, 5, 'Outstanding');
  end if;

  if not exists (select 1 from public.onboarding_templates where organisation_id = p_org) then
    insert into public.onboarding_templates(organisation_id, kind, title, category, owner_role, sort_order, due_offset_days) values
      (p_org,'onboarding','Collect personal information','information','employee',1,-3),
      (p_org,'onboarding','Collect employment information','information','hr',2,-3),
      (p_org,'onboarding','Upload identity & education documents','documents','employee',3,0),
      (p_org,'onboarding','Verify documents','verification','hr',4,2),
      (p_org,'onboarding','Confirm department & designation','assignment','hr',5,0),
      (p_org,'onboarding','Assign reporting manager','assignment','hr',6,0),
      (p_org,'onboarding','Assign shift','assignment','hr',7,0),
      (p_org,'onboarding','Create login account','account','it',8,0),
      (p_org,'onboarding','Allocate laptop / tools / ID card','asset','admin',9,0),
      (p_org,'onboarding','Enrol face for attendance (with consent)','account','hr',10,1),
      (p_org,'onboarding','Acknowledge company policies','policy','employee',11,3),
      (p_org,'onboarding','HR completion approval','approval','hr',12,7),
      (p_org,'offboarding','Knowledge handover document','handover','employee',1,-7),
      (p_org,'offboarding','Handover sign-off by manager','handover','manager',2,-2),
      (p_org,'offboarding','Return company assets','asset_return','employee',3,0),
      (p_org,'offboarding','Revoke system access','access','it',4,0),
      (p_org,'offboarding','Exit interview','interview','hr',5,-1),
      (p_org,'offboarding','Full & final settlement','settlement','finance',6,30);
  end if;
end $$;

create or replace function public.bootstrap_org_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.bootstrap_organisation(new.id); return new; end $$;
create trigger trg_org_bootstrap after insert on public.organisations for each row execute function public.bootstrap_org_trigger();

-- ---------- access summary for the client ----------
create or replace function public.get_my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'organisation_id', public.current_org_id(),
    'employee_id', public.current_employee_id(),
    'roles', coalesce((select jsonb_agg(r.code) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid()), '[]'::jsonb),
    'permissions', case
       when exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                    where ur.user_id = auth.uid() and rp.permission_code = '*')
         then (select jsonb_agg(code) from public.permissions)
       else coalesce((select jsonb_agg(distinct rp.permission_code) from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
                      where ur.user_id = auth.uid()), '[]'::jsonb) end,
    'is_manager', exists (select 1 from public.employees where reporting_manager_id = public.current_employee_id() and status not in ('exited','inactive')),
    'active', coalesce((select is_active from public.user_profiles where id = auth.uid()), false)
  )
$$;

-- ---------- dashboards ----------
create or replace function public.dashboard_summary(p_date date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v jsonb; v_scope uuid[];
begin
  if not (public.has_permission('dashboard.view') or public.has_permission('attendance.view_team')) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select array_agg(id) into v_scope from public.employees e where e.organisation_id = v_org and e.deleted_at is null
    and (public.has_permission('attendance.view') or public.is_subordinate(e.id, public.current_employee_id()));
  v_scope := coalesce(v_scope, '{}');
  select jsonb_build_object(
    'total_employees', (select count(*) from public.employees where id = any(v_scope) and status <> 'exited'),
    'active_employees', (select count(*) from public.employees where id = any(v_scope) and status in ('active','probation','notice')),
    'new_joiners_month', (select count(*) from public.employees where id = any(v_scope) and date_trunc('month', date_of_joining) = date_trunc('month', p_date)),
    'exits_month', (select count(*) from public.employees where id = any(v_scope) and date_trunc('month', exit_date) = date_trunc('month', p_date)),
    'present', (select count(*) from public.attendance_records where employee_id = any(v_scope) and work_date = p_date and first_in is not null),
    'late', (select count(*) from public.attendance_records where employee_id = any(v_scope) and work_date = p_date and is_late),
    'on_leave', (select count(distinct employee_id) from public.leave_applications where employee_id = any(v_scope) and status = 'approved' and p_date between start_date and end_date),
    'offsite', (select count(*) from public.attendance_records where employee_id = any(v_scope) and work_date = p_date and (is_offsite or site_id in (select id from public.work_sites where site_type = 'customer'))),
    'missing_checkout', (select count(*) from public.attendance_records where employee_id = any(v_scope) and work_date between p_date - 7 and p_date and missing_checkout and not is_regularised),
    'pending_approvals', (select count(*) from public.approval_requests where organisation_id = v_org and status = 'pending' and requester_employee_id = any(v_scope)),
    'my_pending_approvals', (select count(*) from public.approval_tasks where approver_user_id = auth.uid() and status = 'pending'),
    'pending_claims', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount),0)) from public.expense_claims where employee_id = any(v_scope) and status = 'submitted'),
    'approved_unpaid_claims', (select coalesce(sum(coalesce(approved_amount, amount)),0) from public.expense_claims where employee_id = any(v_scope) and status = 'approved'),
    'payroll', case when public.has_permission('payroll.view') then
       (select jsonb_build_object('month', pp.period_month, 'status', pr.status, 'net', pr.total_net, 'gross', pr.total_gross, 'employees', pr.employee_count, 'employer_cost', pr.total_employer_cost)
        from public.payroll_runs pr join public.payroll_periods pp on pp.id = pr.period_id where pr.organisation_id = v_org order by pp.period_month desc limit 1) end,
    'department_headcount', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(d.name,'Unassigned'), 'count', x.c) order by x.c desc), '[]') from
       (select department_id, count(*) c from public.employees where id = any(v_scope) and status in ('active','probation','notice','onboarding') group by department_id) x
       left join public.departments d on d.id = x.department_id),
    'attendance_trend', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'present', p, 'late', l, 'absent', a, 'leave', lv) order by d), '[]') from (
       select g.d::date d,
         count(*) filter (where ar.first_in is not null) p, count(*) filter (where ar.is_late) l,
         count(*) filter (where ar.status = 'absent') a, count(*) filter (where ar.status = 'on_leave') lv
       from generate_series(p_date - 13, p_date, interval '1 day') g(d)
       left join public.attendance_records ar on ar.work_date = g.d::date and ar.employee_id = any(v_scope)
       group by g.d) t),
    'leave_trend', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'days', days) order by m), '[]') from (
       select to_char(g.m, 'YYYY-MM') m, coalesce(sum(la.days), 0) days
       from generate_series(date_trunc('month', p_date) - interval '5 months', date_trunc('month', p_date), interval '1 month') g(m)
       left join public.leave_applications la on la.status = 'approved' and date_trunc('month', la.start_date) = g.m and la.employee_id = any(v_scope)
       group by g.m) t),
    'employment_types', (select coalesce(jsonb_agg(jsonb_build_object('type', employment_type, 'count', c)), '[]') from
       (select employment_type, count(*) c from public.employees where id = any(v_scope) and status in ('active','probation','notice') group by employment_type) t),
    'recent_activity', case when public.has_permission('admin.audit') then (select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
       select al.action, al.table_name, al.note, al.created_at, up.full_name actor from public.audit_logs al left join public.user_profiles up on up.id = al.actor_id
       where al.organisation_id = v_org order by al.created_at desc limit 12) t)
     else (select coalesce(jsonb_agg(row_to_json(t)), '[]') from (
       select ar.title note, ar.status action, ar.submitted_at created_at, public.employee_name(ar.requester_employee_id) actor, ar.entity_type table_name
       from public.approval_requests ar where ar.organisation_id = v_org and ar.requester_employee_id = any(v_scope) order by ar.submitted_at desc limit 12) t) end
  ) into v;
  return v;
end $$;

create or replace function public.attendance_range_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_scope uuid[]; v_org uuid := public.current_org_id();
begin
  select array_agg(id) into v_scope from public.employees e where e.organisation_id = v_org and e.deleted_at is null and e.status <> 'exited'
    and (e.id = public.current_employee_id() or public.has_permission('attendance.view') or public.is_subordinate(e.id, public.current_employee_id()));
  return (select jsonb_build_object(
    'employees', coalesce(array_length(v_scope,1),0),
    'present', count(*) filter (where first_in is not null),
    'absent', count(*) filter (where status = 'absent'),
    'late', count(*) filter (where is_late),
    'early', count(*) filter (where is_early_departure),
    'on_leave', count(*) filter (where status = 'on_leave'),
    'offsite', count(*) filter (where is_offsite),
    'missing_checkout', count(*) filter (where missing_checkout and not is_regularised),
    'worked_minutes', coalesce(sum(worked_minutes), 0),
    'overtime_minutes', coalesce(sum(overtime_minutes), 0),
    'working_records', count(*) filter (where status not in ('holiday','weekly_off')),
    'attendance_pct', round(100.0 * count(*) filter (where status in ('present','half_day','incomplete')) / nullif(count(*) filter (where status not in ('holiday','weekly_off','on_leave')), 0), 1)
  ) from public.attendance_records where employee_id = any(coalesce(v_scope,'{}')) and work_date between p_from and p_to);
end $$;

create or replace function public.my_home() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.current_employee_id(); v_org uuid := public.current_org_id(); v_year int;
begin
  if v_emp is null then return null; end if;
  v_year := public.leave_year_of(v_org, current_date);
  return jsonb_build_object(
    'today', (select row_to_json(r) from public.attendance_records r where employee_id = v_emp and work_date = (now() at time zone public.org_timezone(v_org))::date),
    'open_session', (select row_to_json(x) from (select event_type, occurred_at, site_id from public.attendance_events where employee_id = v_emp order by occurred_at desc limit 1) x),
    'shift', (select row_to_json(s) from public.employee_shift(v_emp, current_date) s),
    'balances', (select coalesce(jsonb_agg(jsonb_build_object('leave_type_id', lt.id, 'name', lt.name, 'code', lt.code, 'color', lt.color,
                    'balance', coalesce(lb.balance, 0), 'available', public.leave_available(v_emp, lt.id, v_year), 'used', coalesce(lb.used,0),
                    'accrues', exists (select 1 from public.leave_policies lp where lp.leave_type_id = lt.id and lp.is_active and lp.accrual_frequency <> 'none')) order by lt.name), '[]')
                 from public.leave_types lt left join public.leave_balances lb on lb.leave_type_id = lt.id and lb.employee_id = v_emp and lb.leave_year = v_year
                 join public.employees me on me.id = v_emp
                 where lt.organisation_id = v_org and lt.is_active and lt.requires_balance
                   and (lt.gender_restriction is null or lt.gender_restriction = me.gender)),
    'latest_payslip', (select row_to_json(x) from (select ps.id, ps.period_month, pe.net_pay, pe.gross_earnings from public.payslips ps join public.payroll_entries pe on pe.id = ps.entry_id
                        where ps.employee_id = v_emp order by ps.period_month desc limit 1) x),
    'claims', (select jsonb_build_object('pending', count(*) filter (where status = 'submitted'), 'approved', count(*) filter (where status = 'approved'),
                 'pending_amount', coalesce(sum(amount) filter (where status in ('submitted','approved')), 0)) from public.expense_claims where employee_id = v_emp),
    'pending_tasks', (select count(*) from public.approval_tasks where approver_user_id = auth.uid() and status = 'pending')
                   + (select count(*) from public.onboarding_tasks t join public.onboarding_cases c on c.id = t.case_id where c.employee_id = v_emp and t.owner_role = 'employee' and t.status = 'pending')
                   + (select count(*) from public.appraisal_reviews where employee_id = v_emp and stage = 'self' and status = 'pending'),
    'learning', (select jsonb_build_object('enrolled', count(*), 'completed', count(*) filter (where status = 'completed'), 'avg_progress', coalesce(round(avg(progress)),0),
                   'due_soon', count(*) filter (where status not in ('completed','withdrawn') and due_date <= current_date + 7)) from public.course_enrolments where employee_id = v_emp),
    'holidays', (select coalesce(jsonb_agg(jsonb_build_object('date', holiday_date, 'name', name, 'type', holiday_type) order by holiday_date), '[]') from (
                   select * from public.holidays where organisation_id = v_org and holiday_date >= current_date order by holiday_date limit 5) h),
    'face', (select jsonb_build_object('status', coalesce((select status from public.face_enrolments where employee_id = v_emp), 'not_enrolled'),
                                        'consent', public.has_consent(v_emp, 'biometric'), 'location_consent', public.has_consent(v_emp, 'location'))),
    'settings', (select jsonb_build_object('face_required', cs.face_recognition_enabled and cs.face_required_for_clock, 'face_enabled', cs.face_recognition_enabled,
                    'gps_mode', cs.gps_mode, 'allow_new_site', cs.allow_new_site_entry, 'match_threshold', cs.face_match_threshold,
                    'antispoof_threshold', cs.face_antispoof_threshold, 'liveness_threshold', cs.face_liveness_threshold, 'face_provider', cs.face_provider,
                    'min_samples', cs.face_min_samples)
                 from public.company_settings cs where cs.organisation_id = v_org),
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'latitude', s.latitude, 'longitude', s.longitude, 'radius_m', s.radius_m,
                 'assigned', exists (select 1 from public.employee_site_assignments a where a.site_id = s.id and a.employee_id = v_emp and (a.valid_to is null or a.valid_to >= current_date)),
                 'primary', exists (select 1 from public.employee_site_assignments a where a.site_id = s.id and a.employee_id = v_emp and a.is_primary)) order by s.name), '[]')
              from public.work_sites s where s.organisation_id = v_org and s.is_active and s.is_approved)
  );
end $$;

-- ---------- report views (security_invoker => caller's RLS applies) ----------
create view public.v_attendance_register with (security_invoker = true) as
  select ar.*, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name, e.department_id, d.name as department_name,
         e.designation_id, g.name as designation_name, s.name as shift_name, ws.name as site_name
  from public.attendance_records ar
  join public.employees e on e.id = ar.employee_id
  left join public.departments d on d.id = e.department_id
  left join public.designations g on g.id = e.designation_id
  left join public.shifts s on s.id = ar.shift_id
  left join public.work_sites ws on ws.id = ar.site_id;

create view public.v_leave_register with (security_invoker = true) as
  select la.*, lt.name as leave_type_name, lt.color, lt.is_paid, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name,
         e.department_id, d.name as department_name, e.designation_id
  from public.leave_applications la
  join public.leave_types lt on lt.id = la.leave_type_id
  join public.employees e on e.id = la.employee_id
  left join public.departments d on d.id = e.department_id;

create view public.v_leave_balances with (security_invoker = true) as
  select lb.*, lt.name as leave_type_name, lt.code as leave_type_code, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name,
         e.department_id, d.name as department_name, e.designation_id
  from public.leave_balances lb join public.leave_types lt on lt.id = lb.leave_type_id
  join public.employees e on e.id = lb.employee_id left join public.departments d on d.id = e.department_id;

create view public.v_employee_register with (security_invoker = true) as
  select e.id, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name, e.official_email, e.mobile, e.gender,
         e.date_of_joining, e.employment_type, e.status, e.exit_date, e.department_id, d.name as department_name,
         e.designation_id, g.name as designation_name, l.name as location_name, trim(m.first_name || ' ' || m.last_name) as manager_name,
         e.is_field_employee
  from public.employees e left join public.departments d on d.id = e.department_id left join public.designations g on g.id = e.designation_id
  left join public.locations l on l.id = e.location_id left join public.employees m on m.id = e.reporting_manager_id
  where e.deleted_at is null;

create view public.v_payroll_register with (security_invoker = true) as
  select pe.*, pp.period_month, pr.status as run_status, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name,
         e.department_id, d.name as department_name, e.designation_id, g.name as designation_name,
         (select coalesce(sum(amount),0) from public.payroll_entry_lines l where l.entry_id = pe.id and l.component_code = 'BASIC') as basic,
         (select coalesce(sum(amount),0) from public.payroll_entry_lines l where l.entry_id = pe.id and l.component_code = 'PF') as pf,
         (select coalesce(sum(amount),0) from public.payroll_entry_lines l where l.entry_id = pe.id and l.component_code = 'ESI') as esi,
         (select coalesce(sum(amount),0) from public.payroll_entry_lines l where l.entry_id = pe.id and l.component_code = 'PT') as pt
  from public.payroll_entries pe join public.payroll_runs pr on pr.id = pe.run_id join public.payroll_periods pp on pp.id = pr.period_id
  join public.employees e on e.id = pe.employee_id left join public.departments d on d.id = e.department_id left join public.designations g on g.id = e.designation_id;

create view public.v_claims_register with (security_invoker = true) as
  select c.id, c.organisation_id, c.employee_id, c.claim_number, c.category_id, c.title, c.description, c.expense_date, c.amount, c.approved_amount,
         c.currency, c.project_reference, coalesce(c.department_id, e.department_id) as department_id, c.status, c.policy_violation, c.justification,
         c.is_possible_duplicate, c.duplicate_of, c.submitted_at, c.decided_at, c.rejection_reason, c.reimbursement_id, c.created_at, c.updated_at,
         cc.name as category_name, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name, e.designation_id,
         d.name as department_name, (select count(*) from public.claim_attachments a where a.claim_id = c.id) as attachment_count,
         rb.batch_reference, rb.paid_on
  from public.expense_claims c join public.claim_categories cc on cc.id = c.category_id
  join public.employees e on e.id = c.employee_id left join public.departments d on d.id = coalesce(c.department_id, e.department_id)
  left join public.reimbursements rb on rb.id = c.reimbursement_id;

create view public.v_training_register with (security_invoker = true) as
  select ce.*, c.title as course_title, c.is_mandatory, cat.name as category_name, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name,
         e.department_id, d.name as department_name, e.designation_id, cert.certificate_number
  from public.course_enrolments ce join public.courses c on c.id = ce.course_id left join public.course_categories cat on cat.id = c.category_id
  join public.employees e on e.id = ce.employee_id left join public.departments d on d.id = e.department_id
  left join public.certificates cert on cert.enrolment_id = ce.id;

create view public.v_appraisal_register with (security_invoker = true) as
  select r.*, c.name as cycle_name, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name, e.department_id, d.name as department_name, e.designation_id
  from public.appraisal_reviews r join public.appraisal_cycles c on c.id = r.cycle_id join public.employees e on e.id = r.employee_id
  left join public.departments d on d.id = e.department_id;

create view public.v_field_visits with (security_invoker = true) as
  select v.*, ws.name as site_name, ws.client_name, e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name, e.department_id, e.designation_id,
         round(extract(epoch from (coalesce(v.check_out_at, now()) - v.check_in_at)) / 60) as duration_minutes
  from public.field_visits v join public.employees e on e.id = v.employee_id left join public.work_sites ws on ws.id = v.site_id;

create view public.v_lifecycle_register with (security_invoker = true) as
  select 'onboarding'::text as kind, oc.id, oc.employee_id, oc.status, oc.joining_date as key_date, oc.created_at,
         (select count(*) from public.onboarding_tasks t where t.case_id = oc.id) as total_tasks,
         (select count(*) from public.onboarding_tasks t where t.case_id = oc.id and t.status <> 'pending') as done_tasks,
         e.employee_code, trim(e.first_name || ' ' || e.last_name) as employee_name, e.department_id, e.designation_id, null::text as reason
  from public.onboarding_cases oc join public.employees e on e.id = oc.employee_id
  union all
  select 'offboarding', fc.id, fc.employee_id, fc.status, coalesce(fc.approved_lwd, fc.requested_lwd), fc.created_at,
         (select count(*) from public.offboarding_tasks t where t.case_id = fc.id),
         (select count(*) from public.offboarding_tasks t where t.case_id = fc.id and t.status <> 'pending'),
         e.employee_code, trim(e.first_name || ' ' || e.last_name), e.department_id, e.designation_id, fc.separation_type || ': ' || fc.reason
  from public.offboarding_cases fc join public.employees e on e.id = fc.employee_id;

grant select on public.v_attendance_register, public.v_leave_register, public.v_leave_balances, public.v_employee_register, public.v_payroll_register,
  public.v_claims_register, public.v_training_register, public.v_appraisal_register, public.v_field_visits, public.v_lifecycle_register to authenticated;

create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  owner_id uuid not null references public.user_profiles(id) on delete cascade,
  name text not null,
  dataset text not null,
  config jsonb not null,               -- UI configuration (columns, filters, sort)
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.saved_reports enable row level security;
create policy sr_rw on public.saved_reports for all to authenticated
  using (organisation_id = public.current_org_id() and (owner_id = auth.uid() or is_shared))
  with check (organisation_id = public.current_org_id() and owner_id = auth.uid());

-- ---------- scheduled jobs ----------
alter table public.announcements add column notified_at timestamptz;

create or replace function public.notify_due_announcements() returns int
language plpgsql security definer set search_path = public as $$
declare a public.announcements; e record; n int := 0;
begin
  for a in select * from public.announcements where status = 'published' and publish_at <= now() and notified_at is null loop
    for e in select id, user_id from public.employees where organisation_id = a.organisation_id and status not in ('exited','inactive') loop
      if public.announcement_visible_to(a, e.id) then
        perform public.notify(e.user_id, 'announcements', 'announcement.published', jsonb_build_object('title', a.title, 'body', left(a.body, 160)), '/me/announcements', 'announcement', a.id);
      end if;
    end loop;
    update public.announcements set notified_at = now() where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- publish_announcement marks notified so cron does not repeat
create or replace function public.publish_announcement(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('engagement.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  update public.announcements set status = 'published' where id = p_id and organisation_id = public.current_org_id();
  return public.notify_due_announcements();
end $$;

create or replace function public.send_daily_reminders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_train int := 0; v_cel int := 0;
begin
  for r in select ce.id, e.user_id, c.title, ce.due_date from public.course_enrolments ce join public.employees e on e.id = ce.employee_id
           join public.courses c on c.id = ce.course_id
           where ce.status in ('enrolled','in_progress') and ce.due_date between current_date and current_date + 3 loop
    perform public.notify(r.user_id, 'learning', 'learning.due', jsonb_build_object('title', 'Training due ' || to_char(r.due_date, 'DD Mon') || ': ' || r.title), '/me/learning');
    v_train := v_train + 1;
  end loop;
  for r in select e.id, e.user_id, m.user_id mgr, trim(e.first_name || ' ' || e.last_name) nm,
                  (to_char(e.date_of_birth, 'MM-DD') = to_char(current_date, 'MM-DD')) is_bday,
                  extract(year from age(current_date, e.date_of_joining))::int yrs
           from public.employees e left join public.employees m on m.id = e.reporting_manager_id
           where e.status in ('active','probation','notice')
             and (to_char(e.date_of_birth, 'MM-DD') = to_char(current_date, 'MM-DD')
                  or (to_char(e.date_of_joining, 'MM-DD') = to_char(current_date, 'MM-DD') and e.date_of_joining < current_date)) loop
    if r.is_bday then
      perform public.notify(r.user_id, 'celebrations', 'celebration.birthday', jsonb_build_object('title', 'Happy birthday, ' || r.nm || '!'), '/me');
      perform public.notify(r.mgr, 'celebrations', 'celebration.team', jsonb_build_object('title', 'It''s ' || r.nm || '''s birthday today'), '/engagement/recognition');
    else
      perform public.notify(r.user_id, 'celebrations', 'celebration.anniversary', jsonb_build_object('title', 'Happy ' || r.yrs || '-year work anniversary!'), '/me');
      perform public.notify(r.mgr, 'celebrations', 'celebration.team', jsonb_build_object('title', r.nm || ' completes ' || r.yrs || ' years today'), '/engagement/recognition');
    end if;
    v_cel := v_cel + 1;
  end loop;
  return jsonb_build_object('training', v_train, 'celebrations', v_cel);
end $$;

-- ---------- default notification templates (global) ----------
insert into public.notification_templates(organisation_id, code, title_template, body_template, send_email) values
 (null,'approval.pending','{{title}}','{{requester}} submitted "{{request}}". Step: {{step}}.', true),
 (null,'approval.completed','{{title}}','Your request "{{request}}" was {{status}}. {{comment}}', true),
 (null,'approval.reminder','{{title}}','"{{request}}" is still waiting for your decision.', true),
 (null,'approval.escalated','{{title}}','"{{request}}" was escalated to you because it was not actioned in time.', true),
 (null,'attendance.missing_checkout','{{title}}','You did not check out on {{date}}. Submit a regularisation request if this is wrong.', true),
 (null,'payroll.published','{{title}}','Your payslip for {{month}} is available in self-service.', true),
 (null,'claim.reimbursed','{{title}}','Amount {{amount}} has been reimbursed.', true),
 (null,'announcement.published','{{title}}','{{body}}', false),
 (null,'appraisal.self_due','{{title}}','Please complete your self assessment.', true),
 (null,'appraisal.manager_due','{{title}}','Self assessment submitted; your review is due.', true),
 (null,'learning.assigned','{{title}}','Due {{due}}.', true),
 (null,'learning.due','{{title}}','Please complete it before the due date.', true),
 (null,'celebration.birthday','{{title}}','Wishing you a wonderful year ahead.', false),
 (null,'celebration.anniversary','{{title}}','Thank you for being part of the team.', false),
 (null,'celebration.team','{{title}}','Say hello and recognise them.', false)
on conflict do nothing;

-- ---------- function privileges ----------
-- Supabase grants EXECUTE on new functions to anon/authenticated by default. Internal functions are revoked.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (
             p.proname like '\_%' or p.proname like 'approval_hook_%' or p.proname in (
             'audit_trigger','log_action','notify','notify_permission','resolve_step_approvers','delegate_for','create_step_tasks','advance_request',
             'complete_request','submit_for_approval','recompute_attendance_day','process_daily_attendance','ingest_device_punch','purge_sensitive_data',
             'escalate_overdue_approvals','leave_txn_apply','recalc_enrolment','bootstrap_organisation','bootstrap_org_trigger','notify_due_announcements',
             'send_daily_reminders','set_updated_at','employees_before_insert','claims_before_insert','payroll_guard','leave_txn_immutable',
             'employees_prevent_delete','render_template'))
  loop
    execute format('revoke execute on function %s from public', f.sig);
    begin execute format('revoke execute on function %s from anon, authenticated', f.sig); exception when undefined_object then null; end;
  end loop;
  -- anonymous users never call any RPC
  begin execute 'revoke execute on all functions in schema public from anon'; exception when undefined_object then null; end;
end $$;

-- live notification bell (Supabase Realtime); RLS still applies to subscribers
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
