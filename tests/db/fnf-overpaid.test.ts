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
    // independent check (calendar-day basis): paid days after the 10th = days 11..end, minus LOP already after the 10th
    const { after } = (await db.query<any>(`select ((date_trunc('month', $1::date) + interval '1 month - 1 day')::date - $1::date)
        - coalesce((select sum(case when status = 'absent' then 1 when status = 'half_day' and leave_application_id is null then 0.5 else 0 end)
                    from attendance_records where employee_id = $2 and work_date > $1::date
                      and work_date <= (date_trunc('month', $1::date) + interval '1 month - 1 day')::date), 0)
        - coalesce((select sum(count_leave_days($2, greatest(la.start_date, $1::date + 1), least(la.end_date, (date_trunc('month', $1::date) + interval '1 month - 1 day')::date), la.is_half_day))
                    from leave_applications la join leave_types lt on lt.id = la.leave_type_id
                    where la.employee_id = $2 and la.status = 'approved' and not lt.is_paid and la.end_date > $1::date
                      and la.start_date <= (date_trunc('month', $1::date) + interval '1 month - 1 day')::date), 0) as after`, [lwd, EMP])).rows[0]
    const over = Math.min(Number(pe.p), Number(after))
    expect(rec.amount).toBe(Math.round((pe.net * over) / Number(pe.p)))
    expect(rec.basis).toMatch(new RegExp(`^${String(over).replace('.', '\\.')} of `))   // half days kept, not rounded
  })
})
