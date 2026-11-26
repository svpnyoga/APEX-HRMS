// Face self-enrolment: once freely; afterwards only with an HR-approved request, used once.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
const model = 'human-faceres-v1'
const five = JSON.stringify(Array.from({ length: 5 }, (_, i) => [1 + i * 0.01, 1, 1, 1]))
let emp: string
beforeAll(async () => {
  db = await createDb()
  await db.query(`update company_settings set face_recognition_enabled = true`)
  emp = (await db.query<any>(`select id from employees where user_id = $1`, [USERS.field])).rows[0].id
  await db.query(`delete from face_enrolments where employee_id = $1`, [emp])
  await db.query(`delete from face_templates where employee_id = $1`, [emp])
}, 120_000)
const me = (fn: (q: any) => Promise<any>) => asUser(db, USERS.field, fn)
const status = async () => (await me((q) => q(`select face_self_status() s`)))[0].s

describe('face self-enrolment', () => {
  it('needs the employee’s own consent first', async () => {
    await db.query(`delete from data_consents where employee_id = $1 and consent_type = 'biometric'`, [emp])
    expect((await status()).state).toBe('first_enrolment')
    await me(async (q) => { await expect(q(`select face_self_enrol($1, $2::jsonb)`, [model, five])).rejects.toThrow(/consent/i) })
    await me((q) => q(`select record_consent('biometric', true, 'v1', null)`))
  })
  it('first enrolment works without HR approval, and HR is notified', async () => {
    const [r] = await me((q) => q(`select face_self_enrol($1, $2::jsonb) r`, [model, five]))
    expect(r.r.samples).toBe(5)
    expect((await status()).state).toBe('enrolled')
    const n = (await db.query<any>(`select count(*)::int n from notifications where title like '%enrolled their face'`)).rows[0].n
    expect(n).toBeGreaterThan(0)
  })
  it('a second enrolment is refused without a request', async () => {
    await me(async (q) => { await expect(q(`select face_self_enrol($1, $2::jsonb)`, [model, five])).rejects.toThrow(/re-enrolment request/i) })
  })
  it('request → HR rejects → still refused; the employee is told why', async () => {
    const [{ id }] = await me((q) => q(`select request_face_reenrol('New phone') id`))
    expect((await status()).state).toBe('reenrol_pending')
    await me(async (q) => { await expect(q(`select request_face_reenrol('Again')`)).rejects.toThrow(/already have an open/i) })
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select decide_face_reenrol($1, false, '')`, [id])).rejects.toThrow(/reason/i)
      await q(`select decide_face_reenrol($1, false, 'Come to the office first')`, [id])
    })
    expect((await status()).last_request.status).toBe('rejected')
    await me(async (q) => { await expect(q(`select face_self_enrol($1, $2::jsonb)`, [model, five])).rejects.toThrow(/re-enrolment request/i) })
  })
  it('request → HR approves → one re-enrolment, then locked again', async () => {
    const [{ id }] = await me((q) => q(`select request_face_reenrol('Grew a beard') id`))
    await asUser(db, USERS.employee, async (q) => { await expect(q(`select decide_face_reenrol($1, true)`, [id])).rejects.toThrow(/not authorised/i) })
    await asUser(db, USERS.hr, (q) => q(`select decide_face_reenrol($1, true)`, [id]))
    expect((await status()).state).toBe('reenrol_approved')
    const [r] = await me((q) => q(`select face_self_enrol($1, $2::jsonb) r`, [model, five]))
    expect(r.r.reenrolment).toBe(true)
    expect((await status()).state).toBe('enrolled')
    await me(async (q) => { await expect(q(`select face_self_enrol($1, $2::jsonb)`, [model, five])).rejects.toThrow(/re-enrolment request/i) })
  })
  it('employees cannot write requests directly or see other people’s', async () => {
    await me(async (q) => { await expect(q(`update face_reenrol_requests set status = 'approved'`)).resolves.toBeDefined() })
    expect((await db.query<any>(`select count(*)::int n from face_reenrol_requests where status = 'approved'`)).rows[0].n).toBe(0)
    const seen = await asUser(db, USERS.employee, (q) => q<any>(`select 1 from face_reenrol_requests`))
    expect(seen).toHaveLength(0)
  })
  it('after HR revokes, the employee needs a request (not a free first enrolment)', async () => {
    await asUser(db, USERS.hr, (q) => q(`select face_revoke_enrolment($1, 'test')`, [emp]))
    expect((await status()).state).toBe('revoked')
    await me(async (q) => { await expect(q(`select face_self_enrol($1, $2::jsonb)`, [model, five])).rejects.toThrow(/re-enrolment request/i) })
  })
})
