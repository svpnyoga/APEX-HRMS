// Field visits: times are set by the server, a visit can be ended once, finished visits can't be rewritten,
// and only one visit can be open at a time.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
beforeAll(async () => { db = await createDb() })

const start = (q: any, extra = '') =>
  q(`insert into field_visits (organisation_id, employee_id, purpose${extra ? ', check_in_at' : ''})
     values (current_org_id(), current_employee_id(), 'Installation'${extra ? `, ${extra}` : ''}) returning id, check_in_at`)

describe('field visits', () => {
  it('a backdated start time is replaced with the real time', async () => {
    await asUser(db, USERS.field, async (q) => {
      const [v] = await start(q, `now() - interval '3 hours'`)
      const [{ age }] = await q<any>(`select extract(epoch from now() - check_in_at) age from field_visits where id = $1`, [v.id])
      expect(Number(age)).toBeLessThan(60)
    })
  })
  it('only one visit can be open at a time', async () => {
    await asUser(db, USERS.field, async (q) => {
      await expect(start(q)).rejects.toThrow(/already have a visit in progress/i)
    })
  })
  it('the start time cannot be edited afterwards', async () => {
    await asUser(db, USERS.field, async (q) => {
      await expect(q(`update field_visits set check_in_at = now() - interval '5 hours' where employee_id = current_employee_id() and check_out_at is null`))
        .rejects.toThrow(/cannot be changed/i)
    })
  })
  it('ending a visit records the real end time, even if another time is sent', async () => {
    await asUser(db, USERS.field, async (q) => {
      const [v] = await q<any>(`update field_visits set check_out_at = now() + interval '4 hours', outcome = 'Done'
        where employee_id = current_employee_id() and check_out_at is null returning check_out_at, outcome`)
      const [{ diff }] = await q<any>(`select abs(extract(epoch from $1::timestamptz - now())) diff`, [v.check_out_at])
      expect(Number(diff)).toBeLessThan(60)
      expect(v.outcome).toBe('Done')
    })
  })
  it('a finished visit cannot be rewritten by the employee', async () => {
    await asUser(db, USERS.field, async (q) => {
      await expect(q(`update field_visits set check_out_at = now() + interval '2 hours' where employee_id = current_employee_id() and check_out_at is not null`))
        .rejects.toThrow(/already ended/i)
      await expect(q(`update field_visits set outcome = 'Changed later' where employee_id = current_employee_id() and check_out_at is not null`))
        .rejects.toThrow(/already ended/i)
    })
  })
  it('a new visit can be started once the last one has ended', async () => {
    await asUser(db, USERS.field, async (q) => {
      const [v] = await start(q)
      expect(v.id).toBeTruthy()
    })
  })
})
