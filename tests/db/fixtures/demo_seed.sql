-- =====================================================================
-- TEST FIXTURE — loaded only by the automated test-suite (tests/db/harness.ts).
-- It is NOT a seed for real installations. The accounts it creates get a random,
-- unknown password, so nobody can sign in with them even if this file is loaded.
-- Dates are relative to the day the seed runs so the demo always looks current.
-- =====================================================================
begin;

-- ---------- organisation (bootstrap trigger creates roles, settings, workflows, templates) ----------
insert into public.organisations (id, name, legal_name, code, city, state, email, phone, timezone)
values ('00000000-0000-4000-a000-000000000001', 'Apex Industrial Metrology', 'Apex Industrial Metrology LLP', 'APEX', 'Chennai', 'Tamil Nadu',
        'hr@apex.demo', '+91 44 0000 0000', 'Asia/Kolkata');

update public.company_settings set email_from_name = 'Apex HR', email_from_address = 'hr@apex.demo', gps_mode = 'flag'
where organisation_id = '00000000-0000-4000-a000-000000000001';

-- ---------- auth users (Supabase local auth schema) ----------
do $$
declare u record;
begin
  for u in select * from (values
    ('10000000-0000-4000-a000-000000000001'::uuid, 'admin@apex.demo',    'Priya Raman'),
    ('10000000-0000-4000-a000-000000000002'::uuid, 'hr@apex.demo',       'Karthik Subramanian'),
    ('10000000-0000-4000-a000-000000000003'::uuid, 'finance@apex.demo',  'Lakshmi Narayanan'),
    ('10000000-0000-4000-a000-000000000004'::uuid, 'manager@apex.demo',  'Arun Kumar'),
    ('10000000-0000-4000-a000-000000000005'::uuid, 'employee@apex.demo', 'Divya Shankar'),
    ('10000000-0000-4000-a000-000000000006'::uuid, 'field@apex.demo',    'Senthil Murugan'),
    ('10000000-0000-4000-a000-000000000007'::uuid, 'kiosk@apex.demo',    'Gate Kiosk'),
    ('10000000-0000-4000-a000-000000000008'::uuid, 'md@apex.demo',       'Ramesh Iyer')
  ) as t(id, email, name) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, crypt(gen_random_uuid()::text, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now());
    insert into public.user_profiles (id, organisation_id, email, full_name) values (u.id, '00000000-0000-4000-a000-000000000001', u.email, u.name);
  end loop;
end $$;

insert into public.user_roles (user_id, role_id)
select x.uid, r.id from (values
  ('10000000-0000-4000-a000-000000000001'::uuid, 'super_admin'),
  ('10000000-0000-4000-a000-000000000002'::uuid, 'hr_admin'),
  ('10000000-0000-4000-a000-000000000003'::uuid, 'finance_admin'),
  ('10000000-0000-4000-a000-000000000004'::uuid, 'dept_manager'),
  ('10000000-0000-4000-a000-000000000005'::uuid, 'employee'),
  ('10000000-0000-4000-a000-000000000006'::uuid, 'field_employee'),
  ('10000000-0000-4000-a000-000000000007'::uuid, 'kiosk'),
  ('10000000-0000-4000-a000-000000000008'::uuid, 'management')
) as x(uid, code) join public.roles r on r.code = x.code and r.organisation_id = '00000000-0000-4000-a000-000000000001';
-- managers and HR are employees too
insert into public.user_roles (user_id, role_id)
select x.uid, r.id from (values
  ('10000000-0000-4000-a000-000000000002'::uuid), ('10000000-0000-4000-a000-000000000003'::uuid),
  ('10000000-0000-4000-a000-000000000004'::uuid), ('10000000-0000-4000-a000-000000000001'::uuid), ('10000000-0000-4000-a000-000000000008'::uuid)
) as x(uid) join public.roles r on r.code = 'employee' and r.organisation_id = '00000000-0000-4000-a000-000000000001';

-- ---------- master data ----------
insert into public.locations (id, organisation_id, name, city, state, address) values
  ('20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Chennai Head Office', 'Chennai', 'Tamil Nadu', 'Ambattur Industrial Estate, Chennai'),
  ('20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Hosur Assembly Plant', 'Hosur', 'Tamil Nadu', 'SIPCOT Phase II, Hosur');

insert into public.departments (id, organisation_id, name, code) values
  ('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Management', 'MGT'),
  ('30000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Opto Metrology', 'OPT'),
  ('30000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'New Product Development', 'NPD'),
  ('30000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', 'Quality & Calibration', 'QC'),
  ('30000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001', 'Service & Installation', 'SRV'),
  ('30000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001', 'Human Resources', 'HR'),
  ('30000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000001', 'Finance & Accounts', 'FIN');

insert into public.designations (id, organisation_id, name, level) values
  ('40000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'Managing Director', 10),
  ('40000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Head of Operations', 8),
  ('40000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', 'HR Manager', 6),
  ('40000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000001', 'Accounts Manager', 6),
  ('40000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001', 'Design Engineer', 4),
  ('40000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001', 'Service Engineer', 4),
  ('40000000-0000-4000-a000-000000000007', '00000000-0000-4000-a000-000000000001', 'Calibration Technician', 3),
  ('40000000-0000-4000-a000-000000000008', '00000000-0000-4000-a000-000000000001', 'Assembly Technician', 2),
  ('40000000-0000-4000-a000-000000000009', '00000000-0000-4000-a000-000000000001', 'Graduate Engineer Trainee', 1);

insert into public.shifts (id, organisation_id, name, code, start_time, end_time, break_minutes, is_default, color) values
  ('50000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', 'General', 'GEN', '09:30', '18:30', 60, true, '#4338CA'),
  ('50000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', 'Plant early', 'EARLY', '07:00', '15:30', 30, false, '#0F766E');

-- ---------- employees ----------
insert into public.employees (id, organisation_id, user_id, employee_code, first_name, last_name, official_email, mobile, date_of_birth, gender,
  date_of_joining, employment_type, department_id, designation_id, reporting_manager_id, location_id, shift_id, is_field_employee, status, city, state)
values
 ('60000000-0000-4000-a000-000000000008','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000008','EMP0001','Ramesh','Iyer','md@apex.demo','9800000008','1972-03-11','male','2009-06-01','full_time','30000000-0000-4000-a000-000000000001','40000000-0000-4000-a000-000000000001',null,'20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001','EMP0002','Priya','Raman','admin@apex.demo','9800000001','1985-07-21','female','2014-04-07','full_time','30000000-0000-4000-a000-000000000001','40000000-0000-4000-a000-000000000002','60000000-0000-4000-a000-000000000008','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000002','EMP0003','Karthik','Subramanian','hr@apex.demo','9800000002','1988-11-05','male','2017-08-14','full_time','30000000-0000-4000-a000-000000000006','40000000-0000-4000-a000-000000000003','60000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000003','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000003','EMP0004','Lakshmi','Narayanan','finance@apex.demo','9800000003','1986-02-17','female','2016-01-11','full_time','30000000-0000-4000-a000-000000000007','40000000-0000-4000-a000-000000000004','60000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000004','EMP0005','Arun','Kumar','manager@apex.demo','9800000004','1984-09-30','male','2015-03-02','full_time','30000000-0000-4000-a000-000000000003','40000000-0000-4000-a000-000000000005','60000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000005','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000005','EMP0006','Divya','Shankar','employee@apex.demo','9800000005','1996-12-08','female','2021-07-19','full_time','30000000-0000-4000-a000-000000000003','40000000-0000-4000-a000-000000000005','60000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000006','00000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000006','EMP0007','Senthil','Murugan','field@apex.demo','9800000006','1992-05-14','male','2019-10-01','full_time','30000000-0000-4000-a000-000000000005','40000000-0000-4000-a000-000000000006','60000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',true,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000009','00000000-0000-4000-a000-000000000001',null,'EMP0008','Meena','Balaji','meena@apex.demo','9800000009','1994-01-25','female','2020-02-03','full_time','30000000-0000-4000-a000-000000000004','40000000-0000-4000-a000-000000000007','60000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000010','00000000-0000-4000-a000-000000000001',null,'EMP0009','Vignesh','Raja','vignesh@apex.demo','9800000010','1998-08-02','male','2022-06-06','full_time','30000000-0000-4000-a000-000000000002','40000000-0000-4000-a000-000000000008','60000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000002','50000000-0000-4000-a000-000000000002',false,'active','Hosur','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000011','00000000-0000-4000-a000-000000000001',null,'EMP0010','Ananya','Krishnan','ananya@apex.demo','9800000011','1999-04-19','female','2023-09-11','full_time','30000000-0000-4000-a000-000000000002','40000000-0000-4000-a000-000000000007','60000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000002','50000000-0000-4000-a000-000000000002',false,'active','Hosur','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000012','00000000-0000-4000-a000-000000000001',null,'EMP0011','Gokul','Prasad','gokul@apex.demo','9800000012','1995-10-27','male','2018-12-03','full_time','30000000-0000-4000-a000-000000000005','40000000-0000-4000-a000-000000000006','60000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',true,'notice','Chennai','Tamil Nadu'),
 ('60000000-0000-4000-a000-000000000013','00000000-0000-4000-a000-000000000001',null,'EMP0012','Harini','Venkat','harini@apex.demo','9800000013','2002-06-15','female',current_date + 3,'trainee','30000000-0000-4000-a000-000000000003','40000000-0000-4000-a000-000000000009','60000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000001','50000000-0000-4000-a000-000000000001',false,'active','Chennai','Tamil Nadu');

update public.departments set head_employee_id = '60000000-0000-4000-a000-000000000004' where id = '30000000-0000-4000-a000-000000000003';
update public.departments set head_employee_id = '60000000-0000-4000-a000-000000000002' where id = '30000000-0000-4000-a000-000000000006';

insert into public.employee_bank_details (employee_id, bank_name, account_holder, account_number, ifsc, pan, uan, esi_applicable)
select id, 'Demo Bank', first_name || ' ' || last_name, 'XXXXXX' || right(mobile, 4), 'DEMO0000123', 'ABCDE' || right(mobile,4) || 'F', '1000' || right(mobile, 8), false
from public.employees where organisation_id = '00000000-0000-4000-a000-000000000001';
update public.employee_bank_details set esi_applicable = true where employee_id in ('60000000-0000-4000-a000-000000000010','60000000-0000-4000-a000-000000000011');

insert into public.employee_contacts (employee_id, name, relationship, phone, is_primary)
select id, 'Family contact', 'Spouse', '90000' || right(mobile, 5), true from public.employees where organisation_id = '00000000-0000-4000-a000-000000000001';

insert into public.document_types (organisation_id, name, is_mandatory_onboarding) values
  ('00000000-0000-4000-a000-000000000001', 'Aadhaar card', true), ('00000000-0000-4000-a000-000000000001', 'PAN card', true),
  ('00000000-0000-4000-a000-000000000001', 'Degree certificate', true), ('00000000-0000-4000-a000-000000000001', 'Relieving letter', false),
  ('00000000-0000-4000-a000-000000000001', 'Offer letter (signed)', true);

-- ---------- sites ----------
insert into public.work_sites (id, organisation_id, name, site_type, client_name, address, latitude, longitude, radius_m) values
  ('70000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','Chennai Head Office','office',null,'Ambattur Industrial Estate',13.0986,80.1622,250),
  ('70000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000001','Hosur Assembly Plant','plant',null,'SIPCOT Phase II, Hosur',12.7409,77.8253,400),
  ('70000000-0000-4000-a000-000000000003','00000000-0000-4000-a000-000000000001','Sriperumbudur auto component customer','customer','Customer A','SIPCOT Sriperumbudur',12.9675,79.9419,300),
  ('70000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000001','Oragadam precision castings','customer','Customer B','Oragadam Industrial Corridor',12.8358,79.9520,300);
insert into public.geofence_settings (organisation_id, site_id, mode, extra_tolerance_m) values ('00000000-0000-4000-a000-000000000001', null, 'flag', 50);
insert into public.employee_site_assignments (employee_id, site_id, is_primary)
select e.id, case when e.location_id = '20000000-0000-4000-a000-000000000002' then '70000000-0000-4000-a000-000000000002'::uuid else '70000000-0000-4000-a000-000000000001'::uuid end, true
from public.employees e where e.organisation_id = '00000000-0000-4000-a000-000000000001';
insert into public.employee_site_assignments (employee_id, site_id) values
  ('60000000-0000-4000-a000-000000000006','70000000-0000-4000-a000-000000000003'),
  ('60000000-0000-4000-a000-000000000006','70000000-0000-4000-a000-000000000004'),
  ('60000000-0000-4000-a000-000000000012','70000000-0000-4000-a000-000000000003');

-- ---------- holidays (Tamil Nadu 2026 — verify against the official gazette) ----------
insert into public.holidays (organisation_id, holiday_date, name, holiday_type) values
 ('00000000-0000-4000-a000-000000000001','2026-01-01','New Year''s Day','company'),
 ('00000000-0000-4000-a000-000000000001','2026-01-15','Pongal','festival'),
 ('00000000-0000-4000-a000-000000000001','2026-01-16','Thiruvalluvar Day','festival'),
 ('00000000-0000-4000-a000-000000000001','2026-01-26','Republic Day','public'),
 ('00000000-0000-4000-a000-000000000001','2026-04-14','Tamil New Year','festival'),
 ('00000000-0000-4000-a000-000000000001','2026-05-01','May Day','public'),
 ('00000000-0000-4000-a000-000000000001','2026-08-15','Independence Day','public'),
 ('00000000-0000-4000-a000-000000000001','2026-10-02','Gandhi Jayanti','public'),
 ('00000000-0000-4000-a000-000000000001','2026-10-20','Ayudha Pooja','festival'),
 ('00000000-0000-4000-a000-000000000001','2026-11-08','Deepavali','festival'),
 ('00000000-0000-4000-a000-000000000001','2026-12-25','Christmas','public'),
 ('00000000-0000-4000-a000-000000000001','2027-01-01','New Year''s Day','company'),
 ('00000000-0000-4000-a000-000000000001','2027-01-15','Pongal','festival');

-- ---------- leave ----------
insert into public.leave_types (id, organisation_id, code, name, is_paid, requires_balance, document_required_after_days, color, gender_restriction, allow_half_day) values
 ('80000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','CL','Casual Leave',true,true,null,'#4338CA',null,true),
 ('80000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000001','SL','Sick Leave',true,true,2,'#DC2626',null,true),
 ('80000000-0000-4000-a000-000000000003','00000000-0000-4000-a000-000000000001','EL','Earned Leave',true,true,null,'#059669',null,false),
 ('80000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000001','LOP','Unpaid Leave',false,false,null,'#64748B',null,true),
 ('80000000-0000-4000-a000-000000000005','00000000-0000-4000-a000-000000000001','CO','Compensatory Off',true,true,null,'#D97706',null,true),
 ('80000000-0000-4000-a000-000000000006','00000000-0000-4000-a000-000000000001','ML','Maternity Leave',true,true,null,'#DB2777','female',false),
 ('80000000-0000-4000-a000-000000000007','00000000-0000-4000-a000-000000000001','PL','Paternity Leave',true,true,null,'#0891B2','male',false);
insert into public.leave_policies (organisation_id, leave_type_id, name, annual_entitlement, accrual_frequency, carry_forward_max, encashable, encash_max_days, effective_from) values
 ('00000000-0000-4000-a000-000000000001','80000000-0000-4000-a000-000000000001','Casual leave policy',12,'monthly',0,false,0,'2026-01-01'),
 ('00000000-0000-4000-a000-000000000001','80000000-0000-4000-a000-000000000002','Sick leave policy',12,'monthly',6,false,0,'2026-01-01'),
 ('00000000-0000-4000-a000-000000000001','80000000-0000-4000-a000-000000000003','Earned leave policy',15,'monthly',30,true,15,'2026-01-01');
-- opening balances for the current leave year (accrued Jan..last month)
insert into public.leave_transactions (employee_id, leave_type_id, leave_year, txn_type, days, period_key, remarks)
select e.id, lt.id, extract(year from current_date)::int, 'opening',
       case lt.code when 'CL' then 2 + (extract(month from current_date) - 1) when 'SL' then 2 + (extract(month from current_date) - 1)
                    when 'EL' then round(1.25 * (extract(month from current_date) - 1) * 2) / 2 + 4 when 'CO' then 1 when 'ML' then 182 when 'PL' then 5 end,
       'opening-' || extract(year from current_date), 'Opening balance (demo)'
from public.employees e cross join public.leave_types lt
where e.organisation_id = '00000000-0000-4000-a000-000000000001' and lt.code in ('CL','SL','EL','CO','ML','PL') and e.date_of_joining <= current_date
  and (lt.gender_restriction is null or lt.gender_restriction = e.gender);

-- ---------- payroll configuration ----------
insert into public.salary_components (organisation_id, code, name, component_type, calc_type, default_value, statutory_code, display_order, prorate) values
 ('00000000-0000-4000-a000-000000000001','BASIC','Basic salary','earning','percent_of_gross',50,null,10,true),
 ('00000000-0000-4000-a000-000000000001','HRA','House rent allowance','earning','percent_of_basic',40,null,20,true),
 ('00000000-0000-4000-a000-000000000001','CONV','Conveyance allowance','earning','fixed',1600,null,30,true),
 ('00000000-0000-4000-a000-000000000001','SPECIAL','Special allowance','earning','balancing',0,null,40,true),
 ('00000000-0000-4000-a000-000000000001','BONUS','Bonus','earning','variable',0,null,70,false),
 ('00000000-0000-4000-a000-000000000001','INCENTIVE','Incentive','earning','variable',0,null,71,false),
 ('00000000-0000-4000-a000-000000000001','PF','Provident Fund','deduction','statutory',0,'PF',200,false),
 ('00000000-0000-4000-a000-000000000001','ESI','Employee State Insurance','deduction','statutory',0,'ESI',210,false),
 ('00000000-0000-4000-a000-000000000001','PT','Professional Tax','deduction','statutory',0,'PT',220,false),
 ('00000000-0000-4000-a000-000000000001','TDS','Income tax (TDS)','deduction','variable',0,'TDS',230,false),
 ('00000000-0000-4000-a000-000000000001','PF_ER','Employer PF','employer_contribution','statutory',0,'PF',300,false),
 ('00000000-0000-4000-a000-000000000001','ESI_ER','Employer ESI','employer_contribution','statutory',0,'ESI',310,false);
insert into public.salary_structures (id, organisation_id, name, description, effective_from) values
 ('90000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','Standard staff','Basic 50% of gross, HRA 40% of basic, conveyance, special balancing','2026-01-01');
insert into public.salary_structure_components (structure_id, component_id, value)
select '90000000-0000-4000-a000-000000000001', id, default_value from public.salary_components
where organisation_id = '00000000-0000-4000-a000-000000000001' and code in ('BASIC','HRA','CONV','SPECIAL');

insert into public.statutory_configs (organisation_id, code, employee_rate, employer_rate, wage_ceiling, eligibility_threshold, effective_from, notes) values
 ('00000000-0000-4000-a000-000000000001','PF',12,12,15000,null,'2026-01-01','Demo values — confirm with current EPFO notification'),
 ('00000000-0000-4000-a000-000000000001','ESI',0.75,3.25,null,21000,'2026-01-01','Demo values — confirm with current ESIC notification'),
 ('00000000-0000-4000-a000-000000000001','GRATUITY',15,26,2000000,5,'2026-01-01','15/26 x last basic x years; cap configurable');
insert into public.professional_tax_slabs (organisation_id, state, min_monthly_gross, max_monthly_gross, monthly_amount, effective_from, notes) values
 ('00000000-0000-4000-a000-000000000001','Tamil Nadu',0,3500,0,'2026-01-01','Demo monthly equivalents of half-yearly slabs — verify with local body'),
 ('00000000-0000-4000-a000-000000000001','Tamil Nadu',3500.01,5000,23,'2026-01-01',null),
 ('00000000-0000-4000-a000-000000000001','Tamil Nadu',5000.01,7500,53,'2026-01-01',null),
 ('00000000-0000-4000-a000-000000000001','Tamil Nadu',7500.01,10000,115,'2026-01-01',null),
 ('00000000-0000-4000-a000-000000000001','Tamil Nadu',10000.01,12500,171,'2026-01-01',null),
 ('00000000-0000-4000-a000-000000000001','Tamil Nadu',12500.01,null,208,'2026-01-01',null);

insert into public.employee_salary_assignments (employee_id, structure_id, monthly_gross, annual_ctc, effective_from)
select e.id, '90000000-0000-4000-a000-000000000001', g.gross, g.gross * 12, least(e.date_of_joining, '2026-01-01')
from public.employees e join (values
  ('60000000-0000-4000-a000-000000000008'::uuid, 450000), ('60000000-0000-4000-a000-000000000001'::uuid, 240000),
  ('60000000-0000-4000-a000-000000000002'::uuid, 110000), ('60000000-0000-4000-a000-000000000003'::uuid, 105000),
  ('60000000-0000-4000-a000-000000000004'::uuid, 125000), ('60000000-0000-4000-a000-000000000005'::uuid, 62000),
  ('60000000-0000-4000-a000-000000000006'::uuid, 48000), ('60000000-0000-4000-a000-000000000009'::uuid, 36000),
  ('60000000-0000-4000-a000-000000000010'::uuid, 19500), ('60000000-0000-4000-a000-000000000011'::uuid, 20500),
  ('60000000-0000-4000-a000-000000000012'::uuid, 52000), ('60000000-0000-4000-a000-000000000013'::uuid, 22000)
) as g(id, gross) on g.id = e.id;
insert into public.employee_recurring_deductions (employee_id, component_code, title, monthly_amount, start_month) values
 ('60000000-0000-4000-a000-000000000008','TDS','Income tax (TDS)',95000,'2026-04-01'),
 ('60000000-0000-4000-a000-000000000001','TDS','Income tax (TDS)',42000,'2026-04-01'),
 ('60000000-0000-4000-a000-000000000004','TDS','Income tax (TDS)',14500,'2026-04-01');
insert into public.employee_loans (organisation_id, employee_id, loan_type, principal, emi, start_month, outstanding, remarks) values
 ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','advance',30000,5000,date_trunc('month', current_date - interval '1 month'),30000,'Salary advance');

-- ---------- claims ----------
insert into public.claim_categories (id, organisation_id, name, code, receipt_required_above) values
 ('a0000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','Travel','TRV',500),
 ('a0000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000001','Food','FOOD',300),
 ('a0000000-0000-4000-a000-000000000003','00000000-0000-4000-a000-000000000001','Accommodation','HOTEL',0),
 ('a0000000-0000-4000-a000-000000000004','00000000-0000-4000-a000-000000000001','Fuel','FUEL',500),
 ('a0000000-0000-4000-a000-000000000005','00000000-0000-4000-a000-000000000001','Local transport','LOCAL',300),
 ('a0000000-0000-4000-a000-000000000006','00000000-0000-4000-a000-000000000001','Office expenses','OFFICE',200);
insert into public.expense_policies (organisation_id, category_id, per_claim_limit, monthly_limit) values
 ('00000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000001',15000,40000),
 ('00000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000002',800,6000),
 ('00000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000003',4500,30000),
 ('00000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000004',3000,9000),
 ('00000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000005',1000,5000),
 ('00000000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000006',2000,5000);

-- ---------- consents (demo employees consented; templates must be captured live) ----------
insert into public.data_consents (employee_id, consent_type, policy_version, granted)
select id, t, 'v1', true from public.employees cross join unnest(array['biometric','location']) t
where organisation_id = '00000000-0000-4000-a000-000000000001' and user_id is not null;

-- ---------- attendance history: last 25 days, varied patterns ----------
do $$
declare d date; e record; v_in timestamptz; v_out timestamptz; r double precision; v_tz text := 'Asia/Kolkata'; s record;
begin
  perform setseed(0.42);
  for d in select g::date from generate_series(current_date - 25, current_date - 1, interval '1 day') g loop
    for e in select * from public.employees where organisation_id = '00000000-0000-4000-a000-000000000001' and date_of_joining <= d and status <> 'exited' loop
      if public.is_weekly_off(e.id, d) or public.is_holiday(e.id, d) then continue; end if;
      select * into s from public.employee_shift(e.id, d);
      r := random();
      if r < 0.05 then continue; end if;                                    -- absent
      v_in := (d + s.start_time) at time zone v_tz + make_interval(mins => (case when r < 0.18 then 12 + (random()*40)::int else -(random()*15)::int end));
      v_out := (d + s.end_time) at time zone v_tz + make_interval(mins => (case when r > 0.93 then -(30 + (random()*60)::int) when r > 0.80 then 45 + (random()*90)::int else (random()*20)::int end));
      perform public._record_attendance_event(e.id, 'in', case when e.is_field_employee then 'field' else 'face' end, 'admin', v_in,
         case when e.is_field_employee and random() < 0.5 then '70000000-0000-4000-a000-000000000003'::uuid else null end, null, null, null, null, 'disabled', null, null, null, 'Demo data');
      if r > 0.06 or d < current_date - 3 then
        perform public._record_attendance_event(e.id, 'out', case when e.is_field_employee then 'field' else 'face' end, 'admin', v_out, null, null, null, null, null, 'disabled', null, null, null, 'Demo data');
      end if;
    end loop;
    perform public.process_daily_attendance(d);
  end loop;
end $$;

-- ---------- act as HR / finance / approvers to create realistic workflow data ----------
-- (auth.uid() reads request.jwt.claim.sub)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000005', true);   -- Divya (employee)
select public.apply_leave('80000000-0000-4000-a000-000000000001', d, d + 1, false, null, 'Family function in Madurai', null)
from (select g::date d from generate_series(current_date + 6, current_date + 20, interval '1 day') g
      where not public.is_weekly_off('60000000-0000-4000-a000-000000000005', g::date) and not public.is_holiday('60000000-0000-4000-a000-000000000005', g::date)
      order by g limit 1) x;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000006', true);   -- Senthil (field)
select public.apply_leave('80000000-0000-4000-a000-000000000002', d, d, false, null, 'Fever', null)
from (select g::date d from generate_series(current_date - 12, current_date - 6, interval '1 day') g
      where not public.is_weekly_off('60000000-0000-4000-a000-000000000006', g::date) and not public.is_holiday('60000000-0000-4000-a000-000000000006', g::date)
      order by g desc limit 1) x;
insert into public.expense_claims (organisation_id, employee_id, category_id, title, description, expense_date, amount, project_reference, status)
values ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','a0000000-0000-4000-a000-000000000004','Fuel — Sriperumbudur installation','Two-wheeler fuel for installation visits', current_date - 4, 450, 'INST-2611-07','draft'),
       ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','a0000000-0000-4000-a000-000000000002','Lunch during calibration visit',null, current_date - 6, 280, 'CAL-2611-03','draft');
select public.submit_claim(id) from public.expense_claims where employee_id = '60000000-0000-4000-a000-000000000006';

-- manager approves Senthil's sick leave (step 1) and HR completes it (step 2)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000004', true);
select public.act_on_approval(t.task_id, 'approve', 'Get well soon') from public.my_approval_tasks t where t.entity_type = 'leave' and t.task_status = 'pending' and t.requester_employee_id = '60000000-0000-4000-a000-000000000006';
select public.act_on_approval(t.task_id, 'approve', 'OK') from public.my_approval_tasks t where t.entity_type = 'expense_claim' and t.task_status = 'pending' and t.amount < 300;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000002', true);
select public.act_on_approval(t.task_id, 'approve', null) from public.my_approval_tasks t
  join public.leave_applications la on la.id = t.entity_id where t.entity_type = 'leave' and t.task_status = 'pending' and la.start_date < current_date;

-- ---------- payroll for last month: HR calculates, approvers approve, finance locks ----------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000003', true);   -- finance
select public.calculate_payroll_run(public.create_payroll_run((date_trunc('month', current_date) - interval '1 month')::date));
select public.submit_payroll_run(id) from public.payroll_runs where organisation_id = '00000000-0000-4000-a000-000000000001';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000002', true);   -- HR review
select public.act_on_approval(t.task_id, 'approve', 'Attendance reconciled') from public.my_approval_tasks t where t.entity_type = 'payroll_run' and t.task_status = 'pending';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000001', true);   -- super admin final
select public.act_on_approval(t.task_id, 'approve', 'Approved') from public.my_approval_tasks t where t.entity_type = 'payroll_run' and t.task_status = 'pending';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000003', true);
select public.lock_payroll_run(id) from public.payroll_runs where organisation_id = '00000000-0000-4000-a000-000000000001' and status = 'approved';
insert into public.payroll_adjustments (organisation_id, employee_id, adjustment_type, component_code, title, amount, effective_month)
values ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000005','earning','INCENTIVE','Design release incentive',7500, date_trunc('month', current_date)),
       ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','earning','INCENTIVE','Installation incentive — 3 sites',4500, date_trunc('month', current_date));

-- ---------- engagement ----------
insert into public.announcements (organisation_id, title, body, category, priority, audience, status, publish_at, notified_at, requires_acknowledgement, policy_version, created_by) values
 ('00000000-0000-4000-a000-000000000001','Deepavali holiday and plant shutdown','The Chennai office and Hosur plant will be closed on Deepavali. Service engineers on customer call-outs should coordinate with their manager.','announcement','important','all','published', now() - interval '3 days', now(), false, null, '10000000-0000-4000-a000-000000000002'),
 ('00000000-0000-4000-a000-000000000001','Profile Projector HT 600 — new model shipped','The NPD and Opto Metrology teams shipped the first units of the updated HT 600 this week. Thank you to everyone in assembly and calibration.','news','normal','all','published', now() - interval '6 days', now(), false, null, '10000000-0000-4000-a000-000000000001'),
 ('00000000-0000-4000-a000-000000000001','Face attendance and data privacy policy','Explains what biometric and location data we collect, why, how long it is kept, and how to withdraw consent. Please read and acknowledge.','policy','important','all','published', now() - interval '10 days', now(), true, 'v1', '10000000-0000-4000-a000-000000000002'),
 ('00000000-0000-4000-a000-000000000001','Calibration lab access timings','Lab access for the Quality team is 08:00–20:00 on working days.','communication','normal','department','published', now() - interval '2 days', now(), false, null, '10000000-0000-4000-a000-000000000002');
update public.announcements set department_id = '30000000-0000-4000-a000-000000000004' where audience = 'department';

insert into public.employee_recognition (organisation_id, from_employee_id, to_employee_id, badge, message) values
 ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000004','60000000-0000-4000-a000-000000000005','innovation','Fixture redesign for the vision system cut setup time by half.'),
 ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','customer_first','Weekend installation at the Sriperumbudur customer went perfectly.');
insert into public.company_events (organisation_id, title, description, event_type, starts_at, ends_at, venue) values
 ('00000000-0000-4000-a000-000000000001','Quarterly town hall','Business update and Q&A with management','town_hall', date_trunc('day', now()) + interval '9 days 15 hours', date_trunc('day', now()) + interval '9 days 16 hours 30 minutes','Chennai HO conference room'),
 ('00000000-0000-4000-a000-000000000001','Metrology safety refresher','Laser and optical equipment safety','training', date_trunc('day', now()) + interval '4 days 11 hours', date_trunc('day', now()) + interval '4 days 12 hours','Hosur plant');
insert into public.surveys (id, organisation_id, title, description, is_anonymous, starts_on, ends_on, status) values
 ('b0000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','Workplace pulse — November','Five quick questions. Responses are anonymous.', true, current_date - 2, current_date + 12, 'active');
insert into public.survey_questions (survey_id, question, question_type, options, sort_order) values
 ('b0000000-0000-4000-a000-000000000001','I have the tools I need to do my job well','rating',null,1),
 ('b0000000-0000-4000-a000-000000000001','My manager gives me useful feedback','rating',null,2),
 ('b0000000-0000-4000-a000-000000000001','Which area should we improve first?','single_choice', array['Training','Tools & equipment','Communication','Workload'],3),
 ('b0000000-0000-4000-a000-000000000001','Would you recommend Apex as a place to work?','yes_no',null,4),
 ('b0000000-0000-4000-a000-000000000001','Anything else you would like to tell us?','text',null,5);
update public.survey_questions set is_required = false where question_type = 'text';

-- ---------- performance ----------
insert into public.appraisal_cycles (id, organisation_id, name, cycle_type, period_start, period_end, self_review_due, manager_review_due, hr_review_due, rating_scale_id, status)
select 'c0000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','H2 2026 review','half_yearly','2026-07-01','2026-12-31','2026-12-20','2027-01-10','2027-01-20', id, 'goal_setting'
from public.rating_scales where organisation_id = '00000000-0000-4000-a000-000000000001' and is_default;
insert into public.performance_kpis (organisation_id, name, department_id, unit, target_value, default_weight) values
 ('00000000-0000-4000-a000-000000000001','On-time design release','30000000-0000-4000-a000-000000000003','%','95',30),
 ('00000000-0000-4000-a000-000000000001','Calibration turnaround time','30000000-0000-4000-a000-000000000004','days','3',30),
 ('00000000-0000-4000-a000-000000000001','Installations completed first-time-right','30000000-0000-4000-a000-000000000005','%','98',40);
insert into public.performance_goals (cycle_id, employee_id, title, target, weight, progress) values
 ('c0000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000005','Release the SPM fixture design for the gear inspection line','Released by 15 Dec',40,65),
 ('c0000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000005','Reduce design change requests after release','Below 2 per project',30,40),
 ('c0000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000005','Complete GD&T advanced course','Certificate',30,80),
 ('c0000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','Complete installations first-time-right','98%',60,70),
 ('c0000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000006','Customer training sessions delivered','10 sessions',40,50);

-- ---------- learning ----------
insert into public.course_categories (id, organisation_id, name) values
 ('d0000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','Compliance'),
 ('d0000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000001','Metrology skills');
insert into public.courses (id, organisation_id, category_id, title, summary, instructor_name, duration_minutes, is_mandatory, passing_score, status) values
 ('e0000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','d0000000-0000-4000-a000-000000000001','POSH awareness','Prevention of sexual harassment at the workplace — rights, process and the Internal Committee.','HR team',45,true,70,'published'),
 ('e0000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000001','d0000000-0000-4000-a000-000000000002','Profile projector fundamentals','Optics, magnification, edge detection and measurement uncertainty on profile projectors.','Opto Metrology team',90,false,70,'published');
insert into public.course_modules (id, course_id, title, sort_order) values
 ('e1000000-0000-4000-a000-000000000001','e0000000-0000-4000-a000-000000000001','Understanding POSH',1),
 ('e1000000-0000-4000-a000-000000000002','e0000000-0000-4000-a000-000000000002','Optics and setup',1),
 ('e1000000-0000-4000-a000-000000000003','e0000000-0000-4000-a000-000000000002','Measurement',2);
insert into public.course_lessons (module_id, title, lesson_type, content, duration_minutes, sort_order) values
 ('e1000000-0000-4000-a000-000000000001','What the law covers','text','The POSH Act requires every workplace with 10 or more employees to constitute an Internal Committee. This lesson explains what conduct is covered and who is protected.',15,1),
 ('e1000000-0000-4000-a000-000000000001','How to raise a complaint','text','Complaints can be made in writing to the Internal Committee within three months of the incident. The committee must complete its inquiry within 90 days.',15,2),
 ('e1000000-0000-4000-a000-000000000002','Magnification and lenses','text','Profile projectors use a collimated light source and projection lens. Typical magnifications are 10x, 20x and 50x; choose the highest magnification that keeps the feature on the screen.',20,1),
 ('e1000000-0000-4000-a000-000000000003','Edge detection and repeatability','text','Measure with the same edge side, keep the stage clean, and repeat each reading three times to estimate repeatability.',25,1);
insert into public.assessments (id, course_id, title, kind, passing_score, max_attempts) values
 ('e2000000-0000-4000-a000-000000000001','e0000000-0000-4000-a000-000000000001','POSH quiz','quiz',70,3);
insert into public.assessment_questions (id, assessment_id, question, sort_order) values
 ('e3000000-0000-4000-a000-000000000001','e2000000-0000-4000-a000-000000000001','Who must constitute an Internal Committee?',1),
 ('e3000000-0000-4000-a000-000000000002','e2000000-0000-4000-a000-000000000001','Within how many days must an inquiry be completed?',2);
insert into public.assessment_options (question_id, option_text, is_correct, sort_order) values
 ('e3000000-0000-4000-a000-000000000001','Workplaces with 10 or more employees',true,1),
 ('e3000000-0000-4000-a000-000000000001','Only government offices',false,2),
 ('e3000000-0000-4000-a000-000000000001','Only companies with over 500 employees',false,3),
 ('e3000000-0000-4000-a000-000000000002','90 days',true,1),
 ('e3000000-0000-4000-a000-000000000002','7 days',false,2),
 ('e3000000-0000-4000-a000-000000000002','1 year',false,3);
insert into public.course_assignments (id, organisation_id, course_id, target_type, due_date, assigned_by) values
 ('e4000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','e0000000-0000-4000-a000-000000000001','all', current_date + 20, '10000000-0000-4000-a000-000000000002');
insert into public.course_enrolments (course_id, employee_id, assignment_id, source, due_date)
select 'e0000000-0000-4000-a000-000000000001', id, 'e4000000-0000-4000-a000-000000000001', 'assigned', current_date + 20
from public.employees where organisation_id = '00000000-0000-4000-a000-000000000001' and status in ('active','notice');
insert into public.training_sessions (organisation_id, course_id, title, trainer, venue, starts_at, ends_at, capacity) values
 ('00000000-0000-4000-a000-000000000001','e0000000-0000-4000-a000-000000000002','Profile projector hands-on','Opto Metrology team','Chennai HO demo lab', date_trunc('day', now()) + interval '6 days 10 hours', date_trunc('day', now()) + interval '6 days 13 hours', 12);

-- ---------- lifecycle ----------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-a000-000000000002', true);    -- HR
select public.start_onboarding('60000000-0000-4000-a000-000000000013', '60000000-0000-4000-a000-000000000005');
update public.onboarding_tasks set status = 'done', completed_at = now() where case_id in (select id from public.onboarding_cases) and sort_order <= 4;
insert into public.employee_assets (organisation_id, employee_id, asset_tag, asset_type, description, issued_on, status) values
 ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000005','LT-0142','Laptop','Dell Precision 3581 (SolidWorks)', '2021-07-19','issued'),
 ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000012','LT-0097','Laptop','Lenovo ThinkPad E14', '2018-12-03','issued'),
 ('00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000012','TK-0021','Tool kit','Field calibration tool kit', '2019-02-01','issued'),
 ('00000000-0000-4000-a000-000000000001',null,'LT-0150','Laptop','Dell Latitude 5440 (spare)', null,'available');
insert into public.offboarding_cases (id, organisation_id, employee_id, separation_type, resignation_date, reason, requested_lwd, approved_lwd, status)
values ('f0000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000012','resignation', current_date - 20, 'Relocating to Coimbatore', current_date + 10, current_date + 10, 'pending_approval');
select public.approval_hook_resignation('f0000000-0000-4000-a000-000000000001', 'approved', 'Seeded');
update public.offboarding_tasks set status = 'done', completed_at = now() where case_id = 'f0000000-0000-4000-a000-000000000001' and sort_order = 1;
update public.clearance_records set status = 'cleared', cleared_at = now() where case_id = 'f0000000-0000-4000-a000-000000000001' and department in ('hr','admin');

select set_config('request.jwt.claim.sub', '', true);
commit;
