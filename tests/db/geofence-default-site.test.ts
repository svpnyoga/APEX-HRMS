// Clock-in location: with no site chosen, the punch is checked against the office, and flagged when outside.
import { describe, it, expect, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
let office: string
// office at a fixed point; 0.001° latitude ≈ 111 m
const LAT = 13.0500, LNG = 80.2000
beforeEach(async () => {
  db = await createDb()
  await db.query(`update company_settings set gps_mode = 'flag', face_required_for_clock = false`)
  await db.query(`delete from employee_site_assignments`)
  await db.query(`update work_sites set is_active = false`)
  office = (await db.query<any>(`insert into work_sites (organisation_id, name, site_type, latitude, longitude, radius_m)
    select organisation_id, 'Apex office', 'office', $1, $2, 150 from employees limit 1 returning id`, [LAT, LNG])).rows[0].id
}, 120_000)

const punch = (lat: number, acc = 20) => asUser(db, USERS.employee, async (q) => {
  await q(`delete from attendance_events where employee_id = current_employee_id()`)
  return (await q<any>(`select clock_event('in', null, null, $1, $2, $3, 'ok') r`, [lat, LNG, acc]))[0].r
})
const last = async () => (await db.query<any>(`select site_id, within_geofence, is_flagged, flag_reason from attendance_events order by recorded_at desc limit 1`)).rows[0]

describe('no site chosen', () => {
  it('2 km away from the office → marked, but flagged for HR, against the office', async () => {
    await punch(LAT + 0.018)
    const e = await last()
    expect(e.site_id).toBe(office)
    expect(e.within_geofence).toBe(false)
    expect(e.is_flagged).toBe(true)
    expect(e.flag_reason).toMatch(/outside site/)
  })
  it('inside the office (100 m) → not flagged', async () => {
    await punch(LAT + 0.0009)
    const e = await last()
    expect(e.within_geofence).toBe(true)
    expect(e.is_flagged).toBe(false)
  })
  it('a very rough GPS reading (1 km accuracy) no longer stretches the radius to ~700 m', async () => {
    await punch(LAT + 0.0054, 1000)   // ~600 m away
    expect((await last()).within_geofence).toBe(false)
  })
  it('an employee’s own primary site is used before the office', async () => {
    const plant = (await db.query<any>(`insert into work_sites (organisation_id, name, site_type, latitude, longitude, radius_m)
      select organisation_id, 'Plant', 'plant', $1, $2, 150 from employees limit 1 returning id`, [LAT + 0.05, LNG])).rows[0].id
    await db.query(`insert into employee_site_assignments (employee_id, site_id, is_primary, valid_from)
      select id, $1, true, current_date - 1 from employees where user_id = $2`, [plant, USERS.employee])
    await punch(LAT + 0.05)
    const e = await last()
    expect(e.site_id).toBe(plant)
    expect(e.within_geofence).toBe(true)
  })
})
