// Engagement: anonymous survey answers can't be tied back to a person, and changing a policy
// version asks everyone to acknowledge it again.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
beforeAll(async () => { db = await createDb() })

describe('anonymous survey', () => {
  it('the response time cannot be matched to who responded', async () => {
    const org = (await db.query<any>(`select organisation_id o from employees limit 1`)).rows[0].o
    const s = (await db.query<any>(`insert into surveys (organisation_id, title, is_anonymous, starts_on, ends_on, status) values ($1, 'Pulse', true, current_date, current_date + 7, 'active') returning id`, [org])).rows[0].id
    const q = (await db.query<any>(`insert into survey_questions (survey_id, question, question_type, sort_order) values ($1, 'Happy at work?', 'rating', 1) returning id`, [s])).rows[0].id
    for (const u of [USERS.employee, USERS.manager]) await asUser(db, u, (x) => x(`select submit_survey($1, $2::jsonb)`, [s, JSON.stringify({ [q]: '4' })]))
    const linked = (await db.query<any>(`select count(*)::int n from survey_participation p join survey_responses r
       on r.survey_id = p.survey_id and r.submitted_at = p.responded_at where p.survey_id = $1`, [s])).rows[0].n
    expect(linked).toBe(0)
    const ids = (await db.query<any>(`select count(*)::int n from survey_responses where survey_id = $1 and employee_id is not null`, [s])).rows[0].n
    expect(ids).toBe(0)
  })
})

describe('policy acknowledgement', () => {
  it('a new policy version must be acknowledged again', async () => {
    const id = await asUser(db, USERS.hr, async (q) => {
      const [a] = await q<any>(`insert into announcements (organisation_id, title, body, category, requires_acknowledgement, policy_version, status, publish_at)
        values (current_org_id(), 'Leave policy', 'v1 text', 'policy', true, '1.0', 'draft', now() - interval '1 minute') returning id`)
      await q(`select publish_announcement($1)`, [a.id])
      return a.id
    })
    await asUser(db, USERS.employee, (q) => q(`select mark_announcement($1, true)`, [id]))
    const before = await asUser(db, USERS.employee, (q) => q<any>(`select acknowledged_at from my_announcements where id = $1`, [id]))
    expect(before[0].acknowledged_at).toBeTruthy()
    await asUser(db, USERS.hr, (q) => q(`update announcements set policy_version = '2.0', body = 'v2 text' where id = $1`, [id]))
    const after = await asUser(db, USERS.employee, (q) => q<any>(`select acknowledged_at, read_at from my_announcements where id = $1`, [id]))
    expect(after[0].acknowledged_at).toBeNull()
    expect(after[0].read_at).toBeNull()
  })
  it('fixing a typo without changing the version keeps acknowledgements', async () => {
    const id = (await db.query<any>(`select id from announcements where title = 'Leave policy'`)).rows[0].id
    await asUser(db, USERS.employee, (q) => q(`select mark_announcement($1, true)`, [id]))
    await asUser(db, USERS.hr, (q) => q(`update announcements set body = 'v2 text, typo fixed' where id = $1`, [id]))
    const r = await asUser(db, USERS.employee, (q) => q<any>(`select acknowledged_at from my_announcements where id = $1`, [id]))
    expect(r[0].acknowledged_at).toBeTruthy()
  })
})

describe('anonymous feedback', () => {
  const ins = (ret: boolean) => `insert into employee_feedback (organisation_id, feedback_type, subject, message, is_anonymous, employee_id)
    values (current_org_id(), 'suggestion', 'Canteen', 'More tea breaks', true, null)${ret ? ' returning id' : ''}`
  it('reading the row back after saving is refused (so the app must not ask for it)', async () => {
    await asUser(db, USERS.employee, async (q) => { await expect(q(ins(true))).rejects.toThrow(/row-level security/i) })
  })
  it('saving without reading back works, and the sender is not stored', async () => {
    await asUser(db, USERS.employee, (q) => q(ins(false)))
    const r = (await db.query<any>(`select employee_id from employee_feedback where subject = 'Canteen'`)).rows
    expect(r).toHaveLength(1)
    expect(r[0].employee_id).toBeNull()
  })
})

describe('anonymous survey results', () => {
  it('stay hidden from HR until at least 3 people have responded', async () => {
    const org = (await db.query<any>(`select organisation_id o from employees limit 1`)).rows[0].o
    const s = (await db.query<any>(`insert into surveys (organisation_id, title, is_anonymous, starts_on, ends_on, status) values ($1, 'Small pulse', true, current_date, current_date + 7, 'active') returning id`, [org])).rows[0].id
    const q = (await db.query<any>(`insert into survey_questions (survey_id, question, question_type, sort_order) values ($1, 'OK?', 'yes_no', 1) returning id`, [s])).rows[0].id
    const seen = () => asUser(db, USERS.hr, (x) => x<any>(`select a.answer_text from survey_answers a join survey_responses r on r.id = a.response_id where r.survey_id = $1`, [s]))
    for (const u of [USERS.employee, USERS.manager]) await asUser(db, u, (x) => x(`select submit_survey($1, $2::jsonb)`, [s, JSON.stringify({ [q]: 'Yes' })]))
    expect(await seen()).toHaveLength(0)
    await asUser(db, USERS.field, (x) => x(`select submit_survey($1, $2::jsonb)`, [s, JSON.stringify({ [q]: 'No' })]))
    expect(await seen()).toHaveLength(3)
  })
})
