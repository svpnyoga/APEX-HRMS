import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createDb } from './harness'

it('reset script keeps the chosen people and setup, clears everything else', async () => {
  const db = await createDb()
  const users = (await db.query<any>(`select email from auth.users order by email`)).rows.map((r: any) => r.email)
  const keepEmails = users.slice(0, 2)
  const keepEmp = (await db.query<any>(`select employee_code from employees e join auth.users u on u.id = e.user_id where u.email = $1`, [keepEmails[0]])).rows[0]?.employee_code
    ?? (await db.query<any>(`select employee_code from employees limit 1`)).rows[0].employee_code
  const before = Object.fromEntries(await Promise.all(['departments', 'leave_types', 'salary_structures', 'roles', 'approval_workflow_steps', 'shifts', 'audit_logs', 'attendance_events', 'leave_balances', 'payroll_runs', 'employees']
    .map(async (t) => [t, (await db.query<any>(`select count(*)::int n from ${t}`)).rows[0].n])))
  let sql = readFileSync('supabase/scripts/reset_to_go_live.sql', 'utf8')
    .replace(`array['svpnyoga@gmail.com', 'vkvasan.cs@gmail.com']`, `array['${keepEmails.join("','")}']`)
    .replace(`array['EMP1001']`, `array['${keepEmp}']`)
  await db.exec(sql)
  const n = async (q: string) => (await db.query<any>(q)).rows[0].n
  expect(await n(`select count(*)::int n from auth.users`)).toBe(2)
  expect(await n(`select count(*)::int n from employees`)).toBe(1)
  expect(await n(`select count(*)::int n from employees where employee_code = '${keepEmp}'`)).toBe(1)
  for (const t of ['attendance_events', 'leave_balances', 'payroll_runs', 'expense_claims', 'courses', 'announcements', 'approval_requests', 'notifications', 'face_templates'])
    expect(await n(`select count(*)::int n from ${t}`), t).toBe(0)
  for (const t of ['departments', 'leave_types', 'salary_structures', 'roles', 'approval_workflow_steps', 'shifts'])
    expect(await n(`select count(*)::int n from ${t}`), t).toBe(before[t])
  expect(await n(`select count(*)::int n from audit_logs`)).toBeGreaterThanOrEqual(before.audit_logs)   // kept, plus the cleanup itself is recorded
  // a failure part-way must change nothing
  const db2 = await createDb()
  const empsBefore = await (async () => (await db2.query<any>(`select count(*)::int n from employees`)).rows[0].n)()
  await expect(db2.exec(sql.replace(`delete from auth.users`, `select 1/0; delete from auth.users`))).rejects.toThrow()
  expect((await db2.query<any>(`select count(*)::int n from employees`)).rows[0].n).toBe(empsBefore)
  expect(before.attendance_events + before.payroll_runs).toBeGreaterThan(0)   // the demo data really had activity
}, 120_000)

it('the delete guard is back on afterwards', async () => {
  const db = await createDb()
  const users = (await db.query<any>(`select email from auth.users order by email`)).rows.map((r: any) => r.email)
  const keepEmp = (await db.query<any>(`select employee_code from employees limit 1`)).rows[0].employee_code
  await db.exec(readFileSync('supabase/scripts/reset_to_go_live.sql', 'utf8')
    .replace(`array['svpnyoga@gmail.com', 'vkvasan.cs@gmail.com']`, `array['${users.slice(0, 2).join("','")}']`).replace(`array['EMP1001']`, `array['${keepEmp}']`))
  await expect(db.exec(`delete from employees`)).rejects.toThrow(/cannot be deleted/i)
}, 120_000)
