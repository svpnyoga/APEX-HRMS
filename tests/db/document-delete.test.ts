// Deleting employee documents: HR any status; employee only their own pending/rejected ones.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
let emp: string, other: string
const add = async (e: string, status: string) => (await db.query<any>(
  `insert into employee_documents (employee_id, title, storage_path, verification_status) values ($1::uuid, 'Aadhaar', 'org/' || $1::text || '/x.pdf', $2) returning id`, [e, status])).rows[0].id
const gone = async (id: string) => (await db.query<any>(`select deleted_at from employee_documents where id = $1`, [id])).rows[0].deleted_at !== null

beforeAll(async () => {
  db = await createDb()
  const id = async (u: string) => (await db.query<any>(`select id from employees where user_id = $1`, [u])).rows[0].id
  emp = await id(USERS.employee); other = await id(USERS.field)
}, 120_000)

describe('delete employee documents', () => {
  it('HR deletes a rejected document; it disappears from lists and returns the file path', async () => {
    const d = await add(emp, 'rejected')
    const path = await asUser(db, USERS.hr, async (q) => (await q<any>(`select delete_employee_document($1) p`, [d]))[0].p)
    expect(path).toContain('/x.pdf')
    expect(await gone(d)).toBe(true)
    expect(await asUser(db, USERS.hr, (q) => q(`select id from employee_documents where id = $1`, [d]))).toHaveLength(0)
  })
  it('HR can also delete a verified one', async () => {
    const d = await add(emp, 'verified')
    await asUser(db, USERS.hr, (q) => q(`select delete_employee_document($1)`, [d]))
    expect(await gone(d)).toBe(true)
  })
  it('an employee deletes their own pending or rejected document', async () => {
    for (const s of ['pending', 'rejected']) {
      const d = await add(emp, s)
      await asUser(db, USERS.employee, (q) => q(`select delete_employee_document($1)`, [d]))
      expect(await gone(d)).toBe(true)
    }
  })
  it("but not a verified one, and never someone else's", async () => {
    const v = await add(emp, 'verified'), o = await add(other, 'pending')
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select delete_employee_document($1)`, [v])).rejects.toThrow(/only be removed by HR/)
      await expect(q(`select delete_employee_document($1)`, [o])).rejects.toThrow(/Not authorised|not found/i)
    })
    expect(await gone(v)).toBe(false); expect(await gone(o)).toBe(false)
  })
})
