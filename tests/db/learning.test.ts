// Learning: employees must not be able to read the answer key of an assessment.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
beforeAll(async () => { db = await createDb() })

describe('assessment answer key', () => {
  it('employees can read the options but not which one is correct', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const opts = await q<any>(`select id, option_text from assessment_options limit 3`)
      expect(opts.length).toBeGreaterThan(0)
      await expect(q(`select is_correct from assessment_options limit 1`)).rejects.toThrow(/permission denied/)
      const key = await q<any>(`select * from assessment_answer_key((select id from assessments limit 1))`)
      expect(key).toHaveLength(0)
    })
  })
  it('learning admins still get the answer key through the function, and can add options', async () => {
    await asUser(db, USERS.hr, async (q) => {
      const key = await q<any>(`select * from assessment_answer_key((select id from assessments limit 1))`)
      expect(key.length).toBeGreaterThan(0)
      const [{ id }] = await q<any>(`insert into assessment_options (question_id, option_text, is_correct, sort_order)
        select id, 'New option', false, 9 from assessment_questions limit 1 returning id`)
      expect(id).toBeTruthy()
    })
  })
  it('scoring still works for the employee', async () => {
    const a = (await db.query<any>(`select a.id, a.course_id from assessments a limit 1`)).rows[0]
    const answers = Object.fromEntries((await db.query<any>(`select q.id q, o.id o from assessment_questions q join assessment_options o on o.question_id = q.id and o.is_correct where q.assessment_id = $1`, [a.id])).rows.map((r: any) => [r.q, r.o]))
    await asUser(db, USERS.employee, async (q) => {
      await q(`select enrol_in_course($1)`, [a.course_id])
      const [r] = await q<any>(`select submit_assessment($1, $2::jsonb) r`, [a.id, JSON.stringify(answers)])
      expect(r.r.score).toBe(100)
    })
  })
})
