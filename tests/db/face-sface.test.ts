// Face model switch to SFace: calibrated scoring, the old model is refused everywhere,
// old-model enrolments count as "not enrolled", and a face that fits another employee better is rejected.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'
import { sfaceScore } from '../../src/face/sface-provider'

let db: PGlite
const SF = 'sface-2021dec-v1', OLD = 'human-faceres-v1'
const unit = (i: number) => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0))
const near = (v: number[], k: number) => v.map((x, i) => (i === 7 ? x + k : x))
const five = (v: number[]) => JSON.stringify([0, 0.01, 0.02, 0.03, 0.04].map((k) => near(v, k)))
const X = unit(0)                                         // the employee
const Y = [0.42, Math.sqrt(1 - 0.42 ** 2), 0, 0, 0, 0, 0, 0]   // a look-alike colleague: cosine 0.42 to X (score 0.675 — above 0.60 on its own)
let emp: string, other: string, field: string

beforeAll(async () => {
  db = await createDb()
  await db.query(`update company_settings set face_recognition_enabled = true, face_required_for_clock = true, face_skip_challenge_in_office = false`)
  const id = async (u: string) => (await db.query<any>(`select id from employees where user_id = $1`, [u])).rows[0].id
  emp = await id(USERS.employee); other = await id(USERS.manager); field = await id(USERS.field)
  await asUser(db, USERS.hr, async (q) => {
    for (const [e, v] of [[emp, X], [other, Y]] as const) {
      await q(`select record_consent('biometric', true, 'v1', null, $1)`, [e])
      await q(`select face_enrol($1, $2, $3::jsonb)`, [e, SF, five(v)])
    }
  })
}, 120_000)

const clock = async (probe: number[], model = SF) => {
  for (const t of ['attendance_events', 'attendance_records', 'face_recognition_attempts']) await db.query(`delete from ${t} where employee_id = $1`, [emp])
  return asUser(db, USERS.employee, async (q) => (await q<any>(`select face_clock($1, $2, 0.9, 0.9, true, 0.9, 'in') r`, [JSON.stringify(probe), model]))[0].r)
}

describe('SFace model', () => {
  it('is the company default and scores like the app: (cosine - 0.15) / 0.40', async () => {
    expect((await db.query<any>(`select face_provider from company_settings`)).rows[0].face_provider).toBe(SF)
    const pairs: [number[], number[]][] = [[X, X], [X, Y], [X, unit(1)], [X, [0.39, Math.sqrt(1 - 0.39 ** 2), 0, 0, 0, 0, 0, 0]]]
    for (const [a, b] of pairs) {
      const s = (await db.query<any>(`select face_similarity($1, $2::vector, $3::vector) s`, [SF, JSON.stringify(a), JSON.stringify(b)])).rows[0].s
      expect(Number(s)).toBeCloseTo(sfaceScore(a, b), 5)
    }
    expect(sfaceScore(X, unit(1))).toBe(0)
    expect(sfaceScore(X, [0.39, Math.sqrt(1 - 0.39 ** 2), 0, 0, 0, 0, 0, 0])).toBeCloseTo(0.6, 5)
  })

  it('own face clocks in', async () => {
    const r = await clock(X); expect(r, JSON.stringify(r)).toMatchObject({ outcome: 'matched' })
  })

  it('a colleague is rejected even when the score alone would pass, because the face fits the colleague better', async () => {
    const r = await clock(Y)
    expect(r.outcome).toBe('no_match')
    expect(r.reason).toMatch(/another employee/)
    expect(Number(r.similarity)).toBeGreaterThan(0.6)   // the old rule (threshold only) would have let this in
  })

  it('an exited colleague does not block anyone', async () => {
    await db.query(`update employees set status = 'exited', exit_date = current_date - 1 where id = $1`, [other])
    expect((await clock(Y)).outcome).toBe('matched')     // nobody else fits better now (score 0.675 ≥ 0.60)
    await db.query(`update employees set status = 'active', exit_date = null where id = $1`, [other])
  })

  it('an old copy of the app (old model) cannot clock in or enrol', async () => {
    const r = await clock(X, OLD)
    expect(r.outcome).toBe('not_enrolled')
    expect(r.reason).toMatch(/refresh/i)
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select face_enrol($1, $2, $3::jsonb)`, [emp, OLD, five(X)])).rejects.toThrow(/old face model/i)
    })
  })

  it('someone enrolled with the old model may enrol again without a request', async () => {
    await db.query(`delete from face_templates where employee_id = $1`, [field])
    await db.query(`insert into face_enrolments (employee_id, status, model, samples_count, enrolled_at)
                    values ($1, 'not_enrolled', $2, 0, now() - interval '3 days')
                    on conflict (employee_id) do update set status = 'not_enrolled', model = $2, samples_count = 0, enrolled_at = now() - interval '3 days'`, [field, OLD])
    const me = (fn: (q: any) => Promise<any>) => asUser(db, USERS.field, fn)
    expect((await me((q) => q(`select face_self_status() s`)))[0].s.state).toBe('first_enrolment')
    await me((q) => q(`select record_consent('biometric', true, 'v1', null)`))
    await me((q) => q(`select face_self_enrol($1, $2::jsonb)`, [SF, five(unit(3))]))
    const s = (await me((q) => q(`select face_self_status() s`)))[0].s
    expect(s.state).toBe('enrolled')
    await me(async (q) => { await expect(q(`select face_self_enrol($1, $2::jsonb)`, [SF, five(unit(3))])).rejects.toThrow(/re-enrolment request/i) })
  })
})
