// An employee can be in several departments; the first is the main one (department_id).
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
const OPT = '30000000-0000-4000-a000-000000000002', NPD = '30000000-0000-4000-a000-000000000003', QC = '30000000-0000-4000-a000-000000000004'
let emp: string
const row = async () => (await db.query<any>(`select department_id, department_ids from employees where id = $1`, [emp])).rows[0]

beforeAll(async () => {
  db = await createDb()
  emp = (await db.query<any>(`select id from employees where user_id = $1`, [USERS.employee])).rows[0].id
}, 120_000)

describe('multiple departments', () => {
  it('existing employees keep their department as the only one', async () => {
    const r = await row()
    expect(r.department_ids).toEqual(r.department_id ? [r.department_id] : [])
  })

  it('HR can put a person in Opto and NPD; the first is the main department', async () => {
    await asUser(db, USERS.hr, (q) => q(`update employees set department_ids = $2 where id = $1`, [emp, [NPD, OPT, NPD]]))
    expect(await row()).toEqual({ department_id: NPD, department_ids: [NPD, OPT] })
  })

  it('a transfer (main department only) swaps the main one and keeps the others', async () => {
    await asUser(db, USERS.hr, (q) => q(`update employees set department_id = $2 where id = $1`, [emp, QC]))
    expect(await row()).toEqual({ department_id: QC, department_ids: [QC, OPT] })
  })

  it('an unknown department is refused', async () => {
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`update employees set department_ids = $2 where id = $1`, [emp, [OPT, '99999999-0000-4000-a000-000000000001']])).rejects.toThrow(/Unknown department/)
    })
  })

  it('a notice for NPD reaches someone whose main department is Opto but who is also in NPD', async () => {
    await asUser(db, USERS.hr, (q) => q(`update employees set department_ids = $2 where id = $1`, [emp, [OPT, NPD]]))
    const id = await asUser(db, USERS.hr, async (q) => {
      const [a] = await q<any>(`insert into announcements (organisation_id, title, body, category, audience, department_id, status, publish_at)
        values (current_org_id(), 'NPD meeting', 'at 10', 'notice', 'department', $1, 'draft', now() - interval '1 minute') returning id`, [NPD])
      await q(`select publish_announcement($1)`, [a.id])
      return a.id
    })
    const seen = await asUser(db, USERS.employee, (q) => q<any>(`select id from my_announcements where id = $1`, [id]))
    expect(seen.length).toBe(1)
  })

  it('the directory lists all departments, main first', async () => {
    const d = (await asUser(db, USERS.hr, (q) => q<any>(`select department_name, department_names from employee_directory where id = $1`, [emp])))[0]
    expect(d.department_name).toBe('Opto Metrology')
    expect(d.department_names).toBe('Opto Metrology, New Product Development')
  })

  it('clearing all departments clears the main one too', async () => {
    await asUser(db, USERS.hr, (q) => q(`update employees set department_ids = '{}' where id = $1`, [emp]))
    expect(await row()).toEqual({ department_id: null, department_ids: [] })
  })
})
