// Employee codes: company format (e.g. AIM001), editable, renumber existing staff without clashes.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
beforeAll(async () => { db = await createDb() })
const add = (q: any, name: string, code: string | null = null) =>
  q(`insert into employees (organisation_id, first_name, date_of_joining, employee_code) values (current_org_id(), $1, current_date, $2) returning employee_code`, [name, code])

describe('employee codes', () => {
  it('keep today’s EMP numbering until the format is changed', async () => {
    const [r] = await asUser(db, USERS.hr, (q) => add(q, 'Old style'))
    expect(r.employee_code).toMatch(/^EMP\d{4}$/)
  })
  it('renumber everyone as AIM001, AIM002… by joining date, with no clashes', async () => {
    const n = await asUser(db, USERS.hr, async (q) => (await q<any>(`select renumber_employee_codes('AIM', 3, 1) n`))[0].n)
    expect(n).toBeGreaterThan(1)
    const codes = (await db.query<any>(`select employee_code c from employees where status <> 'exited' order by employee_code`)).rows.map((r: any) => r.c)
    expect(codes[0]).toBe('AIM001')
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((c: string) => /^AIM\d{3}$/.test(c))).toBe(true)
  })
  it('new employees continue the sequence in the new format', async () => {
    const before = (await db.query<any>(`select count(*)::int n from employees where status <> 'exited'`)).rows[0].n
    const [r] = await asUser(db, USERS.hr, (q) => add(q, 'Newcomer'))
    expect(r.employee_code).toBe('AIM' + String(before + 1).padStart(3, '0'))
  })
  it('a code can be edited, but not to one already in use, and not blanked', async () => {
    await asUser(db, USERS.hr, async (q) => {
      await q(`update employees set employee_code = ' AIM900 ' where employee_code = 'AIM002'`)
      await expect(q(`update employees set employee_code = 'AIM001' where employee_code = 'AIM900'`)).rejects.toThrow(/unique|duplicate/i)
      await q(`update employees set employee_code = '' where employee_code = 'AIM900'`)
    })
    expect((await db.query<any>(`select count(*)::int n from employees where employee_code = 'AIM900'`)).rows[0].n).toBe(1)
  })
  it('automatic codes skip ones that were taken by hand', async () => {
    const next = (await db.query<any>(`select employee_code_next n from company_settings limit 1`)).rows[0].n
    await asUser(db, USERS.hr, (q) => add(q, 'Manual', 'AIM' + String(next).padStart(3, '0')))
    const [r] = await asUser(db, USERS.hr, (q) => add(q, 'Auto'))
    expect(r.employee_code).toBe('AIM' + String(next + 1).padStart(3, '0'))
  })
  it('only HR can renumber', async () => {
    await asUser(db, USERS.employee, async (q) => { await expect(q(`select renumber_employee_codes('X', 3, 1)`)).rejects.toThrow(/not authorised/i) })
  })
})
