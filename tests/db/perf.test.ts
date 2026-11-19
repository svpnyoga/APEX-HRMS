// Appraisal scoring rules found while testing the deployed app.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS, EMP } from './harness'

let db: PGlite
const CYCLE = 'c0000000-0000-4000-a000-000000000001'
const goals = async () => (await db.query<any>(`select id, weight::float w from performance_goals where cycle_id = $1 and employee_id = $2 order by weight desc, title`, [CYCLE, EMP.employee])).rows
const review = async (stage: string) => (await db.query<any>(`select id from appraisal_reviews where cycle_id = $1 and employee_id = $2 and stage = $3`, [CYCLE, EMP.employee, stage])).rows[0].id

beforeAll(async () => {
  db = await createDb()
  await asUser(db, USERS.hr, (q) => q(`select launch_appraisal_reviews($1)`, [CYCLE]))
})

describe('appraisal scoring', () => {
  it('requires a rating for every active goal (one 5/5 must not become a perfect score)', async () => {
    const g = await goals()
    expect(g.length).toBe(3)
    const self = await review('self')
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select submit_appraisal_review($1, $2::jsonb, null, 's', 'i', 'c')`, [self, JSON.stringify([{ goal_id: g[0].id, rating: 5 }])]))
        .rejects.toThrow(/Rate every goal/)
    })
  })
  it('rejects an overall rating outside the scale', async () => {
    const g = await goals()
    const self = await review('self')
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select submit_appraisal_review($1, $2::jsonb, 9, 's', 'i', 'c')`, [self, JSON.stringify(g.map((x: any) => ({ goal_id: x.id, rating: 4 })))]))
        .rejects.toThrow(/Overall rating must be between 1 and 5/)
    })
  })
  it('computes the weighted score over all goals', async () => {
    const g = await goals() // weights 40, 30, 30
    const self = await review('self')
    const [r] = await asUser(db, USERS.employee, (q) => q<any>(`select submit_appraisal_review($1, $2::jsonb, null, 's', 'i', 'c')::float s`,
      [self, JSON.stringify([{ goal_id: g[0].id, rating: 5 }, { goal_id: g[1].id, rating: 3 }, { goal_id: g[2].id, rating: 4 }])]))
    expect(r.s).toBeCloseTo((5 * 40 + 3 * 30 + 4 * 30) / 100, 2) // 4.10
  })
  it('HR cannot finalise before the manager review is submitted', async () => {
    const g = await goals()
    const hr = await review('hr')
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select submit_appraisal_review($1, $2::jsonb, null, '', '', '')`, [hr, JSON.stringify(g.map((x: any) => ({ goal_id: x.id, rating: 4 })))]))
        .rejects.toThrow(/manager review/)
    })
  })
  it('dropped goals are neither required nor counted', async () => {
    const g = await goals()
    await db.query(`update performance_goals set status = 'dropped' where id = $1`, [g[2].id])
    const mgr = await review('manager')
    const [r] = await asUser(db, USERS.manager, (q) => q<any>(`select submit_appraisal_review($1, $2::jsonb, null, '', '', '')::float s`,
      [mgr, JSON.stringify([{ goal_id: g[0].id, rating: 4 }, { goal_id: g[1].id, rating: 2 }, { goal_id: g[2].id, rating: 5 }])]))
    expect(r.s).toBeCloseTo((4 * 40 + 2 * 30) / 70, 2) // 3.14, the dropped goal's 5 is ignored
  })
})
