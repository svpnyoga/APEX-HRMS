// Regression tests for bugs found while testing the deployed app (Nov 2026).
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS, EMP } from './harness'

let db: PGlite
const ORG = '00000000-0000-4000-a000-000000000001'
beforeAll(async () => {
  db = await createDb()
})

const workday = async (offset: number) =>
  (await db.query<any>(`select g::date d from generate_series(current_date - $1::int - 15, current_date - $1::int, interval '1 day') g
     where extract(dow from g) between 1 and 5 and not exists (select 1 from holidays h where h.holiday_date = g::date)
     order by g desc limit 1`, [offset])).rows[0].d

describe('new employee from the app', () => {
  it('HR can insert an employee and read it back (INSERT ... RETURNING)', async () => {
    await asUser(db, USERS.hr, async (q) => {
      const rows = await q<any>(`insert into employees (organisation_id, first_name, last_name, date_of_joining, employment_type)
        values ($1, 'Test', 'Joiner', current_date, 'full_time') returning id, employee_code`, [ORG])
      expect(rows[0].id).toBeTruthy()
      expect(rows[0].employee_code).toBeTruthy()
    })
  })
})

describe('overtime on a normal shift', () => {
  it('a full shift with the break inside is not overtime; staying 1h later is', async () => {
    await db.query(`update company_settings set overtime_enabled = true, overtime_min_minutes = 30`)
    const sh = (await db.query<any>(`select to_char(start_time,'HH24:MI') s, to_char(end_time,'HH24:MI') e,
        to_char(end_time + interval '1 hour','HH24:MI') e1 from employee_shift($1, current_date)`, [EMP.meena])).rows[0]
    const d1 = await workday(50), d2 = await workday(60)
    await asUser(db, USERS.hr, async (q) => {
      await q(`select manual_attendance($1, $2::date, $3::time, $4::time, 'test')`, [EMP.meena, d1, sh.s, sh.e])
      await q(`select manual_attendance($1, $2::date, $3::time, $4::time, 'test')`, [EMP.meena, d2, sh.s, sh.e1])
    })
    const r = await db.query<any>(`select work_date, overtime_minutes from attendance_records where employee_id = $1 and work_date = any($2::date[]) order by work_date`, [EMP.meena, [d1, d2]])
    const ot = (d: any) => r.rows.find((x: any) => +new Date(x.work_date) === +new Date(d)).overtime_minutes
    expect(ot(d1)).toBe(0)
    expect(ot(d2)).toBe(60)
  })
})

describe('manual attendance without check-out', () => {
  it('stays a missing check-out (not regularised) so the dashboard still counts it', async () => {
    const d = await workday(70)
    await asUser(db, USERS.hr, (q) => q(`select manual_attendance($1, $2::date, '09:05', null, 'forgot to punch out')`, [EMP.meena, d]))
    const r = await db.query<any>(`select missing_checkout, is_regularised from attendance_records where employee_id = $1 and work_date = $2`, [EMP.meena, d])
    expect(r.rows[0].missing_checkout).toBe(true)
    expect(r.rows[0].is_regularised).toBe(false)
    await asUser(db, USERS.hr, (q) => q(`select manual_attendance($1, $2::date, '09:05', '18:00', 'corrected')`, [EMP.meena, d]))
    const r2 = await db.query<any>(`select missing_checkout, is_regularised from attendance_records where employee_id = $1 and work_date = $2`, [EMP.meena, d])
    expect(r2.rows[0]).toEqual({ missing_checkout: false, is_regularised: true })
  })
})

describe('approval engine', () => {
  it('does not ask the same approver twice for one request', async () => {
    // a two-step workflow where both steps resolve to the same user
    // 'overtime' has no completion hook, so a fake entity id is fine
    const wf = (await db.query<any>(`insert into approval_workflows (organisation_id, entity_type, name, is_active)
        values ($1, 'overtime', 'Double', true) on conflict (organisation_id, entity_type) do update set is_active = true returning id`, [ORG])).rows[0].id
    await db.query(`delete from approval_workflow_steps where workflow_id = $1`, [wf])
    await db.query(`insert into approval_workflow_steps (workflow_id, step_order, name, approver_type, user_id, mode)
        values ($1, 1, 'First', 'user', $2, 'any'), ($1, 2, 'Second', 'user', $2, 'any')`, [wf, USERS.hr])
    // internal function (not granted to clients); modules call it from their own security-definer RPCs
    const req = (await db.query<any>(`select submit_for_approval('overtime', gen_random_uuid(), $1, 'Test', null, null) id`, [EMP.employee])).rows[0].id
    const t1 = (await db.query<any>(`select id from approval_tasks where request_id = $1 and status = 'pending'`, [req])).rows
    expect(t1).toHaveLength(1)
    await asUser(db, USERS.hr, (q) => q(`select act_on_approval($1, 'approve')`, [t1[0].id]))
    const r = await db.query<any>(`select status from approval_requests where id = $1`, [req])
    expect(r.rows[0].status).toBe('approved')
    const pending = await db.query<any>(`select count(*)::int n from approval_tasks where request_id = $1 and status = 'pending'`, [req])
    expect(pending.rows[0].n).toBe(0)
  })
})

describe('payroll fixes', () => {
  let run: string
  beforeAll(async () => {
    // Chennai-style monthly PT (208.33) produces paise in net pay
    await db.query(`update professional_tax_slabs set monthly_amount = 208.33 where min_monthly_gross >= 12500`)
    run = await asUser(db, USERS.finance, async (q) => {
      const [{ id }] = await q<any>(`select create_payroll_run(date_trunc('month', current_date)::date) id`)
      await q(`select calculate_payroll_run($1)`, [id])
      return id
    })
  })
  it('rounds every net pay to the rupee with a Rounding off line, and gross - deductions = net', async () => {
    const r = await db.query<any>(`select net_pay::float n, gross_earnings::float g, total_deductions::float d,
        exists (select 1 from payroll_entry_lines l where l.entry_id = pe.id and l.component_code = 'ROUND') has_round
      from payroll_entries pe where run_id = $1`, [run])
    expect(r.rows.length).toBeGreaterThan(5)
    for (const row of r.rows) {
      expect(Number.isInteger(row.n)).toBe(true)
      expect(row.n).toBeCloseTo(row.g - row.d, 2)
    }
    expect(r.rows.some((x: any) => x.has_round)).toBe(true)
  })
  it('working-days LOP counts pre-joining days in working days', async () => {
    await db.query(`update company_settings set lop_basis = 'working_days', absent_counts_as_lop = false`)
    const joiner = await asUser(db, USERS.hr, async (q) =>
      (await q<any>(`insert into employees (organisation_id, first_name, last_name, date_of_joining, employment_type, state)
         values ($1, 'Mid', 'Month', date_trunc('month', current_date)::date + 16, 'full_time', 'Tamil Nadu') returning id`, [ORG]))[0].id)
    await db.query(`insert into employee_salary_assignments (employee_id, structure_id, monthly_gross, effective_from)
       select $1, structure_id, 30000, date_trunc('month', current_date)::date from employee_salary_assignments limit 1`, [joiner])
    await asUser(db, USERS.finance, (q) => q(`select calculate_payroll_run($1)`, [run]))
    const e = (await db.query<any>(`select days_in_period::float days, lop_days::float lop, payable_days::float paid from payroll_entries where run_id = $1 and employee_id = $2`, [run, joiner])).rows[0]
    const expected = (await db.query<any>(`select count(*)::float n from generate_series(date_trunc('month', current_date)::date + 16, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, interval '1 day') g
        where not is_weekly_off($1, g::date) and not is_holiday($1, g::date)`, [joiner])).rows[0].n
    expect(e.paid).toBe(expected)
    await db.query(`update company_settings set lop_basis = 'calendar_days', absent_counts_as_lop = true`)
  })
  it('approval card shows the net pay formatted in rupees', async () => {
    await asUser(db, USERS.finance, (q) => q(`select calculate_payroll_run($1)`, [run]))
    await asUser(db, USERS.finance, (q) => q(`select submit_payroll_run($1)`, [run]))
    const r = await db.query<any>(`select summary from approval_requests where entity_type = 'payroll_run' and entity_id = $1`, [run])
    expect(r.rows[0].summary).toMatch(/net ₹[\d,]+\.\d\d/)
  })
})

describe('HR fallback approvers', () => {
  it('creates one task per person even if they hold several HR roles', async () => {
    // admin user also gets hr_admin
    await db.query(`insert into user_roles (user_id, role_id) select $1, id from roles where code = 'hr_admin' on conflict do nothing`, [USERS.admin])
    const wf = (await db.query<any>(`insert into approval_workflows (organisation_id, entity_type, name, is_active)
        values ($1, 'overtime', 'Fallback', true) on conflict (organisation_id, entity_type) do update set is_active = true returning id`, [ORG])).rows[0].id
    await db.query(`delete from approval_workflow_steps where workflow_id = $1`, [wf])
    await db.query(`insert into approval_workflow_steps (workflow_id, step_order, name, approver_type, user_id, mode) values ($1, 1, 'Nobody', 'user', null, 'any')`, [wf])
    const req = (await db.query<any>(`select submit_for_approval('overtime', gen_random_uuid(), $1, 'Fallback test', null, null) id`, [EMP.employee])).rows[0].id
    const r = await db.query<any>(`select approver_user_id, count(*)::int n from approval_tasks where request_id = $1 group by 1`, [req])
    expect(r.rows.length).toBeGreaterThan(0)
    for (const row of r.rows) expect(row.n).toBe(1)
  })
})

describe('link an existing login to an employee', () => {
  it('admin links, re-links and unlinks; employee already linked elsewhere is refused', async () => {
    const free = (await db.query<any>(`select id from employees where user_id is null and deleted_at is null limit 2`)).rows
    await asUser(db, USERS.admin, async (q) => {
      await q(`select link_user_employee($1, $2)`, [USERS.md, free[0].id])
      expect((await q<any>(`select user_id from employees where id = $1`, [free[0].id]))[0].user_id).toBe(USERS.md)
      await q(`select link_user_employee($1, $2)`, [USERS.md, free[1].id]) // move the link
      expect((await q<any>(`select count(*)::int n from employees where user_id = $1`, [USERS.md]))[0].n).toBe(1)
      await expect(q(`select link_user_employee($1, $2)`, [USERS.hr, free[1].id])).rejects.toThrow(/already linked/)
      await q(`select link_user_employee($1, null)`, [USERS.md])
      expect((await q<any>(`select count(*)::int n from employees where user_id = $1`, [USERS.md]))[0].n).toBe(0)
    })
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select link_user_employee($1, $2)`, [USERS.md, free[0].id])).rejects.toThrow(/Not authorised/)
    })
  })
})
