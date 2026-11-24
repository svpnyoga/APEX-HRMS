// An ordinary employee must never see anyone else's pay: salary, increments, payslips, deductions,
// bank details, loans or settlements — through any table or view.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
let me: string
beforeAll(async () => {
  db = await createDb()
  const month = (await db.query<any>(`select date_trunc('month', current_date)::date m`)).rows[0].m
  await asUser(db, USERS.finance, async (q) => {
    const [{ id }] = await q<any>(`select create_payroll_run($1::date) id`, [month])
    await q(`select calculate_payroll_run($1)`, [id])
  })
  me = await asUser(db, USERS.employee, async (q) => (await q<any>(`select current_employee_id() id`))[0].id)
  // make sure there is pay data for other people to (not) see
  const others = (await db.query<any>(`select count(*)::int n from payroll_entries where employee_id <> $1`, [me])).rows[0].n
  expect(others).toBeGreaterThan(0)
}, 120_000)

const byEmployee: [string, string][] = [
  ['employee_salary_assignments', 'employee_id'], ['salary_revisions', 'employee_id'], ['payroll_entries', 'employee_id'],
  ['payslips', 'employee_id'], ['payroll_adjustments', 'employee_id'], ['employee_bank_details', 'employee_id'],
  ['fnf_settlements', 'employee_id'], ['employee_loans', 'employee_id'], ['employee_recurring_deductions', 'employee_id'],
  ['v_payroll_register', 'employee_id'],
]
describe('an employee cannot see other people\'s pay', () => {
  for (const [t, col] of byEmployee) {
    it(t, async () => {
      const rows = await asUser(db, USERS.employee, (q) => q<any>(`select ${col} from ${t} where ${col} is distinct from $1`, [me]))
      expect(rows).toHaveLength(0)
    })
  }
  it('payroll_entry_lines and payroll_deductions (only own lines)', async () => {
    for (const t of ['payroll_entry_lines', 'payroll_deductions']) {
      const rows = await asUser(db, USERS.employee, (q) => q<any>(`select l.entry_id from ${t} l
        where not exists (select 1 from payroll_entries e where e.id = l.entry_id and e.employee_id = $1)`, [me]))
      expect(rows, t).toHaveLength(0)
    }
  })
  it('payroll runs (company totals) and loan recoveries', async () => {
    for (const t of ['payroll_runs', 'loan_recoveries', 'fnf_lines']) {
      const rows = await asUser(db, USERS.employee, (q) => q<any>(`select 1 from ${t}`))
      expect(rows, t).toHaveLength(0)
    }
  })
  it('the employee directory shows no pay columns', async () => {
    const cols = await asUser(db, USERS.employee, (q) => q<any>(`select * from employee_directory limit 1`))
    const keys = Object.keys(cols[0] ?? {}).join(',')
    expect(keys).not.toMatch(/salary|ctc|gross|basic|net_pay|bank|ifsc|account/i)
  })
})
