// F&F: if the final month's payroll was already paid in full, the days after the last working day are recovered.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
const EMP = '60000000-0000-4000-a000-000000000011'
beforeAll(async () => { db = await createDb() })

describe('final month already paid by payroll', () => {
  it('recovers the net pay for the days after the last working day', async () => {
    const month = (await db.query<any>(`select date_trunc('month', current_date)::date m`)).rows[0].m
    const run = await asUser(db, USERS.finance, async (q) => {
      const [{ id }] = await q<any>(`select create_payroll_run($1::date) id`, [month])
      await q(`select calculate_payroll_run($1)`, [id])
      return id
    })
    await db.query(`set session_replication_role = replica`)          // lock directly, skipping the approval chain
    await db.query(`update payroll_runs set status = 'locked' where id = $1`, [run])
    await db.query(`set session_replication_role = origin`)
    const pe = (await db.query<any>(`select net_pay::float net, payable_days p from payroll_entries where run_id = $1 and employee_id = $2`, [run, EMP])).rows[0]
    expect(pe).toBeTruthy()

    const lwd = (await db.query<any>(`select ($1::date + 9)::date d`, [month])).rows[0].d   // 10th of the month
    const id = await asUser(db, USERS.finance, async (q) => (await q<any>(`select compute_fnf($1, $2::date, true) id`, [EMP, lwd]))[0].id)
    const l = (await db.query<any>(`select title, line_type, amount::float amount, basis from fnf_lines where settlement_id = $1`, [id])).rows
    expect(l.find((x: any) => x.title === 'Salary for final month')).toBeFalsy()          // not paid twice
    const rec = l.find((x: any) => x.title === 'Salary paid beyond last working day')
    expect(rec?.line_type).toBe('deduction')
    expect(rec.amount).toBe(Math.round((pe.net * (pe.p - 10)) / pe.p))
  })
})
