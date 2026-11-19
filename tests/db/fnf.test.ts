// Full & final settlement: no double pay with monthly payroll, statutory deductions on final salary, gratuity rules.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
const VIGNESH = '60000000-0000-4000-a000-000000000010' // joined 2022-06-06, gross 19,500 (ESI applicable)
const ANANYA = '60000000-0000-4000-a000-000000000011' // joined 2023-09-11, gross 20,500
beforeAll(async () => { db = await createDb() })

const lines = async (settlement: string) =>
  (await db.query<any>(`select line_type, title, amount::float amount from fnf_lines where settlement_id = $1`, [settlement])).rows

describe('full & final settlement', () => {
  it('pays the final month once, with PF / ESI / PT, and payroll then skips that employee', async () => {
    const lwd = (await db.query<any>(`select (date_trunc('month', current_date) + interval '9 days')::date d`)).rows[0].d
    const id = await asUser(db, USERS.finance, async (q) => (await q<any>(`select compute_fnf($1, $2::date) id`, [VIGNESH, lwd]))[0].id)
    const l = await lines(id)
    const salary = l.find((x: any) => x.title === 'Salary for final month')
    expect(salary).toBeTruthy()
    expect(l.find((x: any) => x.title.startsWith('Provident Fund'))?.amount).toBeGreaterThan(0)
    expect(l.find((x: any) => x.title.startsWith('ESI'))?.amount).toBe(Math.ceil(salary.amount * 0.0075))
    const s = (await db.query<any>(`select total_earnings::float e, total_deductions::float d, net_payable::float n from fnf_settlements where id = $1`, [id])).rows[0]
    expect(s.n).toBeCloseTo(s.e - s.d, 2)

    await db.query(`update employees set exit_date = $2::date, status = 'exited' where id = $1`, [VIGNESH, lwd])
    const run = await asUser(db, USERS.finance, async (q) => {
      const [{ id: r }] = await q<any>(`select create_payroll_run(date_trunc('month', current_date)::date) id`)
      await q(`select calculate_payroll_run($1)`, [r])
      return r
    })
    const inRun = (await db.query<any>(`select count(*)::int n from payroll_entries where run_id = $1 and employee_id = $2`, [run, VIGNESH])).rows[0].n
    expect(inRun).toBe(0)
    const others = (await db.query<any>(`select count(*)::int n from payroll_entries where run_id = $1`, [run])).rows[0].n
    expect(others).toBeGreaterThan(5)
  })

  it('fixed-term (contract) staff get gratuity after 1 year; part-year counts only when over six months', async () => {
    await db.query(`update employees set employment_type = 'contract' where id = $1`, [ANANYA])
    const id = await asUser(db, USERS.finance, async (q) => (await q<any>(`select compute_fnf($1, current_date) id`, [ANANYA]))[0].id)
    const g = (await lines(id)).find((x: any) => x.title === 'Gratuity')
    expect(g).toBeTruthy()
    const yrs = (await db.query<any>(`select (current_date - date_of_joining) / 365.25 y from employees where id = $1`, [ANANYA])).rows[0].y
    const full = Math.floor(yrs) + (yrs - Math.floor(yrs) > 0.5 ? 1 : 0)
    const basic = (await db.query<any>(`select employee_monthly_component($1, 'BASIC', current_date)::float b`, [ANANYA])).rows[0].b
    expect(g.amount).toBe(Math.round((basic * 15) / 26 * full))

    // the same person as a permanent employee with < 5 years gets none
    await db.query(`update employees set employment_type = 'full_time' where id = $1`, [ANANYA])
    const id2 = await asUser(db, USERS.finance, async (q) => (await q<any>(`select compute_fnf($1, current_date) id`, [ANANYA]))[0].id)
    expect((await lines(id2)).find((x: any) => x.title === 'Gratuity')).toBeUndefined()
  })
})

describe('exit completion and clearance dues', () => {
  it('deducts clearance dues in F&F and refuses to complete the exit before the last working day', async () => {
    const PRIYA_RAMAN_EMP = '60000000-0000-4000-a000-000000000009' // meena in the demo seed
    const lwd = (await db.query<any>(`select (current_date + 20)::date d`)).rows[0].d
    const caseId = await asUser(db, USERS.hr, async (q) => (await q<any>(`select submit_resignation('Moving city', $2::date, 'resignation', $1) id`, [PRIYA_RAMAN_EMP, lwd]))[0].id)
    await db.query(`select approval_hook_resignation($1, 'approved', null)`, [caseId])
    await db.query(`update offboarding_cases set status = 'in_clearance' where id = $1`, [caseId])
    await db.query(`update clearance_records set status = 'cleared', dues_amount = case when department = 'it' then 1500 else 0 end, remarks = case when department = 'it' then 'Charger' end where case_id = $1`, [caseId])
    await db.query(`update offboarding_tasks set status = 'done' where case_id = $1`, [caseId])
    await db.query(`update employee_assets set status = 'returned' where employee_id = $1`, [PRIYA_RAMAN_EMP])
    const fnf = await asUser(db, USERS.finance, async (q) => (await q<any>(`select compute_fnf($1, $2::date, false, $3) id`, [PRIYA_RAMAN_EMP, lwd, caseId]))[0].id)
    const dues = (await db.query<any>(`select amount::float a, basis from fnf_lines where settlement_id = $1 and title like 'Clearance dues%'`, [fnf])).rows
    expect(dues).toEqual([{ a: 1500, basis: 'Charger' }])
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select complete_offboarding($1)`, [caseId])).rejects.toThrow(/on or after the last working day/)
    })
  })
})
