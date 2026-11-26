// Faster face clock-in: the blink/turn step may be skipped ONLY when HR switched it on and the server confirms
// a live, accurate GPS position inside an office site. Otherwise a skipped challenge is still refused.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
const model = 'human-faceres-v1'
const face = [3, 3, 3, 3]
const LAT = 13.0, LNG = 80.0
let emp: string
beforeAll(async () => {
  db = await createDb()
  await db.query(`update company_settings set face_provider = 'human-faceres-v1'`)   // these rules are model-independent; written with the old model's numbers
  await db.query(`update company_settings set face_recognition_enabled = true, face_required_for_clock = true, face_skip_challenge_in_office = false`)
  emp = (await db.query<any>(`select id from employees where user_id = $1`, [USERS.employee])).rows[0].id
  await db.query(`delete from employee_site_assignments where employee_id = $1`, [emp])
  await db.query(`update work_sites set is_active = false`)
  await db.query(`insert into work_sites (organisation_id, name, site_type, latitude, longitude, radius_m) select organisation_id, 'Office', 'office', $1, $2, 150 from employees limit 1`, [LAT, LNG])
  await asUser(db, USERS.hr, async (q) => {
    await q(`select record_consent('biometric', true, 'v1', null, $1)`, [emp])
    await q(`select face_enrol($1, $2, $3::jsonb)`, [emp, model, JSON.stringify(Array.from({ length: 5 }, (_, i) => face.map((x, j) => (j === 0 ? x + i * 0.01 : x))))])
  })
}, 120_000)

const clean = async () => {
  for (const t of ['attendance_events', 'attendance_records', 'face_recognition_attempts']) await db.query(`delete from ${t} where employee_id = $1`, [emp])
}
const punch = async (lat: number, opts: { challenge?: boolean; acc?: number; gps?: string; offline?: boolean } = {}) => {
  await clean()
  return asUser(db, USERS.employee, async (q) => (await q<any>(`select face_clock($1, $2, 0.9, 0.9, $3, 0.9, 'in', null, null, $4, $5, $6, $7, null, null, $8) r`,
    [JSON.stringify(face), model, opts.challenge ?? false, lat, LNG, opts.acc ?? 20, opts.gps ?? 'ok', opts.offline ?? false]))[0].r)
}

describe('skip blink/turn inside the office', () => {
  it('switch OFF: a skipped challenge is refused even in the office (old behaviour)', async () => {
    expect((await punch(LAT)).outcome).toBe('liveness_failed')
  })
  it('switch ON + inside the office with good GPS: accepted, and the log says it was skipped', async () => {
    await db.query(`update company_settings set face_skip_challenge_in_office = true`)
    expect((await punch(LAT + 0.0005)).outcome).toBe('matched')       // ~55 m away
    const a = (await db.query<any>(`select challenge_passed, reason from face_recognition_attempts where employee_id = $1`, [emp])).rows[0]
    expect(a.challenge_passed).toBe(false)
    expect(a.reason).toMatch(/skipped \(inside office\)/)
  })
  it('switch ON but outside the office (2 km): still needs the challenge', async () => {
    expect((await punch(LAT + 0.018)).outcome).toBe('liveness_failed')
    expect((await punch(LAT + 0.018, { challenge: true })).outcome).toBe('matched')
  })
  it('switch ON but GPS too rough, unavailable or offline: still needs the challenge', async () => {
    expect((await punch(LAT, { acc: 900 })).outcome).toBe('liveness_failed')
    expect((await punch(LAT, { gps: 'unavailable' })).outcome).toBe('liveness_failed')
    expect((await punch(LAT, { offline: true })).outcome).toBe('liveness_failed')
  })
  it('switch ON but a non-office site was chosen: still needs the challenge', async () => {
    const plant = (await db.query<any>(`insert into work_sites (organisation_id, name, site_type, latitude, longitude, radius_m)
      select organisation_id, 'Customer', 'customer', $1, $2, 150 from employees limit 1 returning id`, [LAT, LNG])).rows[0].id
    await clean()
    const r = await asUser(db, USERS.employee, async (q) => {
      return (await q<any>(`select face_clock($1, $2, 0.9, 0.9, false, 0.9, 'in', $3, null, $4, $5, 20, 'ok') r`, [JSON.stringify(face), model, plant, LAT, LNG]))[0].r
    })
    expect(r.outcome).toBe('liveness_failed')
  })
})
