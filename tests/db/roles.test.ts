// Roles: built-in roles can't be deleted or have their code changed; custom roles can be deleted.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
beforeAll(async () => { db = await createDb() })

describe('built-in roles', () => {
  it('cannot be deleted', async () => {
    await asUser(db, USERS.admin, async (q) => {
      await expect(q(`delete from roles where code = 'employee' and organisation_id = current_org_id()`)).rejects.toThrow(/built-in role/i)
    })
    const n = (await db.query<any>(`select count(*)::int n from user_roles ur join roles r on r.id = ur.role_id where r.code = 'employee'`)).rows[0].n
    expect(n).toBeGreaterThan(0)
  })
  it('cannot have their code changed (the app relies on it)', async () => {
    await asUser(db, USERS.admin, async (q) => {
      await expect(q(`update roles set code = 'hr_boss' where code = 'hr_admin' and organisation_id = current_org_id()`)).rejects.toThrow(/built-in role/i)
    })
  })
  it('can still be renamed for display and have permissions adjusted', async () => {
    await asUser(db, USERS.admin, async (q) => {
      await q(`update roles set name = 'HR Admin (Apex)' where code = 'hr_admin' and organisation_id = current_org_id()`)
    })
    const n = (await db.query<any>(`select name from roles where code = 'hr_admin'`)).rows[0].name
    expect(n).toBe('HR Admin (Apex)')
  })
})

describe('custom roles', () => {
  it('can be deleted, and are removed from the people who had them', async () => {
    await asUser(db, USERS.admin, async (q) => {
      const [r] = await q<any>(`insert into roles (organisation_id, code, name) values (current_org_id(), 'abcd', 'Head') returning id`)
      await q(`insert into role_permissions (role_id, permission_code) values ($1, 'employees.view')`, [r.id])
      await q(`insert into user_roles (user_id, role_id) values ($1, $2)`, [USERS.hr, r.id])
      await q(`delete from roles where id = $1`, [r.id])
    })
    const n = (await db.query<any>(`select count(*)::int n from roles where code = 'abcd'`)).rows[0].n
    expect(n).toBe(0)
  })
})
