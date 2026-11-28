// Forgotten clock-outs: closed at shift end, flagged, no overtime, employee told; reminders; a new day starts with Clock in.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
let emp: string, user: string
const tz = 'Asia/Kolkata'
const at = (daysAgo: number, hhmm: string) => `((current_date - ${daysAgo}) + time '${hhmm}') at time zone '${tz}'`
const punch = (type: string, daysAgo: number, hhmm: string) => db.query(
  `insert into attendance_events (organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status)
   select organisation_id, id, $2, current_date - ${daysAgo}, ${at(daysAgo, hhmm)}, 'face', 'online', 'ok' from employees where id = $1`, [emp, type])
const rec = async (daysAgo: number) => (await db.query<any>(`select * from attendance_records where employee_id = $1 and work_date = current_date - ${daysAgo}`, [emp])).rows[0]

beforeAll(async () => {
  db = await createDb()
  const r = (await db.query<any>(`select id, user_id from employees where user_id = $1`, [USERS.employee])).rows[0]
  emp = r.id; user = r.user_id
  await db.query(`delete from attendance_events where employee_id = $1`, [emp]); await db.query(`delete from attendance_records where employee_id = $1`, [emp])
  await db.query(`update company_settings set missing_checkout_policy = 'flag', overtime_enabled = true, overtime_min_minutes = 30`)
}, 120_000)

describe('forgotten clock-out', () => {
  it('closes an open day at shift end, flags it, adds no overtime and tells the employee', async () => {
    await punch('in', 2, '09:05')
    await db.query(`select recompute_attendance_day($1, current_date - 2)`, [emp])
    expect(Number((await db.query<any>(`select close_forgotten_checkouts() n`)).rows[0].n)).toBe(1)
    const ev = (await db.query<any>(`select source, (occurred_at at time zone '${tz}')::time t from attendance_events where employee_id = $1 and work_date = current_date - 2 and event_type = 'out'`, [emp])).rows
    expect(ev).toHaveLength(1)
    expect(ev[0].source).toBe('auto')
    const sh = (await db.query<any>(`select end_time from employee_shift($1, current_date - 2)`, [emp])).rows[0]
    expect(ev[0].t).toBe(sh.end_time)
    const r = await rec(2)
    expect(r.missing_checkout).toBe(true)
    expect(r.is_flagged).toBe(true)
    expect(r.overtime_minutes).toBe(0)
    expect(r.worked_minutes).toBeGreaterThan(0)
    expect(r.status).not.toBe('incomplete')
    const n = (await db.query<any>(`select title, body from notifications where user_id = $1 order by created_at desc limit 1`, [user])).rows[0]
    expect(n.title).toMatch(/Missing clock-out/)
    expect(n.body).toMatch(/shift end/)
  })

  it('running again changes nothing', async () => {
    expect(Number((await db.query<any>(`select close_forgotten_checkouts() n`)).rows[0].n)).toBe(0)
  })

  it('the nightly close keeps the auto-closed day (not turned into incomplete)', async () => {
    await db.query(`select process_daily_attendance(current_date - 2)`)
    const r = await rec(2)
    expect(r.status).not.toBe('incomplete')
    expect(r.missing_checkout).toBe(true)
  })

  it('a regularisation replaces the automatic clock-out with the real time', async () => {
    await asUser(db, USERS.employee, (q) => q(`select request_regularisation(current_date - 2, '09:05', '19:30', 'missed_punch', 'left late')`))
    const id = (await db.query<any>(`select id from attendance_regularisation where employee_id = $1 order by created_at desc limit 1`, [emp])).rows[0].id
    await db.query(`select approval_hook_attendance_regularisation($1, 'approved', 'ok')`, [id])
    const outs = (await db.query<any>(`select source from attendance_events where employee_id = $1 and work_date = current_date - 2 and event_type = 'out'`, [emp])).rows
    expect(outs.map((o: any) => o.source)).toEqual(['admin'])
    const r = await rec(2)
    expect(r.missing_checkout).toBe(false)
    expect(r.is_regularised).toBe(true)
  })

  it('the policy "half day" is applied to an auto-closed day', async () => {
    await db.query(`update company_settings set missing_checkout_policy = 'half_day'`)
    await punch('in', 3, '09:00')
    await db.query(`select close_forgotten_checkouts()`)
    expect((await rec(3)).status).toBe('half_day')
    await db.query(`update company_settings set missing_checkout_policy = 'flag'`)
  })

  it('a day whose shift has not ended (+2 h) is left open', async () => {
    await db.query(`insert into attendance_events (organisation_id, employee_id, event_type, work_date, occurred_at, method, source, gps_status)
      select organisation_id, id, 'in', (now() at time zone '${tz}')::date, now() - interval '5 minutes', 'face', 'online', 'ok' from employees where id = $1`, [emp])
    const sh = (await db.query<any>(`select (((now() at time zone '${tz}')::date + end_time) at time zone '${tz}') + interval '2 hours' > now() open from employee_shift($1, (now() at time zone '${tz}')::date)`, [emp])).rows[0]
    const n = Number((await db.query<any>(`select close_forgotten_checkouts() n`)).rows[0].n)
    expect(n).toBe(sh.open ? 0 : 1)
  })
})
