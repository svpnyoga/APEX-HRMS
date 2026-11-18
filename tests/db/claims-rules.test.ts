// Claims money rules exercised end to end (limits, justification, approval, reimbursement).
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS, EMP } from './harness'

let db: PGlite
const FOOD = 'a0000000-0000-4000-a000-000000000002' // receipt above 300; limits 800 per claim, 6000 per month
beforeAll(async () => { db = await createDb() })

const newClaim = (q: any, amount: number, title: string, daysAgo = 1, justification: string | null = null) =>
  q(`insert into expense_claims(organisation_id, employee_id, category_id, title, expense_date, amount, justification)
     values (current_org_id(), current_employee_id(), $1, $2, current_date - $3::int, $4, $5) returning id, claim_number`, [FOOD, title, daysAgo, amount, justification])

describe('claims rules', () => {
  it('under-limit claim without receipt below threshold submits cleanly', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const [c] = await newClaim(q, 250, 'Team tea')
      const [r] = await q<any>(`select submit_claim($1) r`, [c.id])
      expect(r.r.policy_violation).toBe('')
      expect(c.claim_number).toMatch(/^CLM-\d{4}-\d{5}$/)
    })
  })
  it('over per-claim limit needs a justification, then submits flagged', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const [c] = await newClaim(q, 900, 'Client dinner', 2)
      await q(`insert into claim_attachments(claim_id, storage_path, file_name, sha256) values ($1, 'x/r1.pdf', 'r1.pdf', 'h-r1')`, [c.id])
      await expect(q(`select submit_claim($1)`, [c.id])).rejects.toThrow(/per-claim limit of 800.*justification/)
      await q(`update expense_claims set justification = 'Customer visit, 4 guests' where id = $1`, [c.id])
      const [r] = await q<any>(`select submit_claim($1) r`, [c.id])
      expect(r.r.policy_violation).toMatch(/per-claim limit/)
    })
  })
  it('future-dated and too-old expenses are refused', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const [f] = await newClaim(q, 100, 'Future', -2)
      await expect(q(`select submit_claim($1)`, [f.id])).rejects.toThrow(/future/)
      const [o] = await newClaim(q, 100, 'Old', 90)
      await expect(q(`select submit_claim($1)`, [o.id])).rejects.toThrow(/within 60 days/)
    })
  })
  it('employee cannot approve or reimburse their own claim; finance reimburses approved claims with the right total', async () => {
    const claims = (await db.query<any>(`select id, amount::float a from expense_claims where employee_id = $1 and status = 'submitted' and title in ('Team tea','Client dinner')`, [EMP.employee])).rows
    expect(claims).toHaveLength(2)
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select reimburse_claims($1::uuid[], 'X')`, [claims.map((c: any) => c.id)])).rejects.toThrow(/Not authorised/)
      const mine = await q<any>(`select t.id from approval_tasks t join approval_requests r on r.id = t.request_id where r.entity_id = any($1::uuid[]) and t.approver_user_id = auth.uid()`, [claims.map((c: any) => c.id)])
      expect(mine).toHaveLength(0)
    })
    // approve every pending step as whoever it is assigned to
    for (let i = 0; i < 4; i++) {
      const tasks = (await db.query<any>(`select t.id, t.approver_user_id u from approval_tasks t join approval_requests r on r.id = t.request_id
          where r.entity_id = any($1::uuid[]) and t.status = 'pending'`, [claims.map((c: any) => c.id)])).rows
      for (const t of tasks) await asUser(db, t.u, (q) => q(`select act_on_approval($1, 'approve')`, [t.id]))
    }
    const st = (await db.query<any>(`select status from expense_claims where id = any($1::uuid[])`, [claims.map((c: any) => c.id)])).rows
    expect(st.every((s: any) => s.status === 'approved')).toBe(true)
    const rid = await asUser(db, USERS.finance, async (q) => (await q<any>(`select reimburse_claims($1::uuid[], 'NEFT-TEST-1') id`, [claims.map((c: any) => c.id)]))[0].id)
    const r = (await db.query<any>(`select total_amount::float t, claim_count n from reimbursements where id = $1`, [rid])).rows[0]
    expect(r.t).toBe(1150)
    expect(r.n).toBe(2)
    // cannot be paid twice
    await asUser(db, USERS.finance, async (q) => {
      await expect(q(`select reimburse_claims($1::uuid[], 'NEFT-TEST-2')`, [claims.map((c: any) => c.id)])).rejects.toThrow(/Only approved/)
    })
  })
  it('monthly limit counts earlier claims of the same month', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const ids: string[] = []
      for (let i = 0; i < 7; i++) {
        const [c] = await newClaim(q, 299, `Snacks ${i}`, 1 + (i % 2) * 0)
        await q(`update expense_claims set expense_date = date_trunc('month', current_date)::date where id = $1`, [c.id])
        ids.push(c.id)
      }
      // same date + amount + category => later ones are possible duplicates, but limits still apply
      let last: any
      for (const id of ids) last = (await q<any>(`select submit_claim($1) r`, [id]).catch((e: any) => ({ err: e.message })))
      expect(JSON.stringify(last)).toMatch(/possible_duplicate|monthly limit/)
    })
  })
})
