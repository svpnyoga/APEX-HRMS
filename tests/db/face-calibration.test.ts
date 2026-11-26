// Face recognition: HR's "Test" must score the same way real check-in does,
// and a former employee's face must not block a current employee at the kiosk.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS, EMP } from './harness'

let db: PGlite
const model = 'human-faceres-v1'
const add = (v: number[], k: number) => v.map((x, i) => (i === 0 ? x + k : x))
beforeAll(async () => { db = await createDb() })

describe('face match scoring', () => {
  it('HR test uses the same top-3 score as real check-in', async () => {
    const probe = [1, 1, 1, 1]
    const samples = [probe, add(probe, 12), add(probe, 12.5), add(probe, 13), add(probe, 13.5)]   // one great sample, four poor ones
    const test = await asUser(db, USERS.hr, async (q) => {
      await q(`select record_consent('biometric', true, 'v1', null, $1)`, [EMP.employee])
      await q(`select face_enrol($1, $2, $3::jsonb)`, [EMP.employee, model, JSON.stringify(samples)])
      return (await q<any>(`select face_test_match($1, $2, $3) r`, [EMP.employee, JSON.stringify(probe), model]))[0].r
    })
    const clock = await asUser(db, USERS.employee, async (q) =>
      (await q<any>(`select face_clock($1, $2, 0.95, 0.95, true, 0.8) r`, [JSON.stringify(probe), model]))[0].r)
    expect(Number(test.similarity)).toBeCloseTo(Number(clock.similarity), 3)
  })

  it('kiosk ignores exited employees when checking for look-alikes', async () => {
    const face = [5, 5, 5, 5]
    const five = JSON.stringify([0, 0.01, 0.02, 0.03, 0.04].map((k) => add(face, k)))
    await asUser(db, USERS.hr, async (q) => {
      for (const e of [EMP.manager, EMP.meena]) {
        await q(`select record_consent('biometric', true, 'v1', null, $1)`, [e])
        await q(`select face_enrol($1, $2, $3::jsonb)`, [e, model, five])
      }
    })
    await db.query(`update employees set status = 'exited', exit_date = current_date - 1 where id = $1`, [EMP.meena])
    const r = await asUser(db, USERS.kiosk, async (q) =>
      (await q<any>(`select kiosk_identify_clock($1, $2, 0.95, 0.95, true, 0.8) r`, [JSON.stringify(face), model]))[0].r)
    expect(r.outcome).toBe('matched')
    expect(r.employee_id).toBe(EMP.manager)
  })
})
