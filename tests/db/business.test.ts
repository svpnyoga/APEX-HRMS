import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS, EMP } from './harness'

let db: PGlite
beforeAll(async () => {
  db = await createDb()
})

const vec = (seed: number, dims = 1024) => {
  // deterministic pseudo-embedding
  const v: number[] = []
  let x = seed
  for (let i = 0; i < dims; i++) {
    x = (x * 9301 + 49297) % 233280
    v.push((x / 233280) * 1.6) // roughly the scale of raw faceres descriptors
  }
  return v
}
const near = (v: number[], eps: number) => v.map((n, i) => n + (i % 2 ? eps : -eps) * 10)

describe('seed workflow outcomes', () => {
  it('created attendance history with late arrivals and statuses', async () => {
    const r = await db.query<any>(`select count(*)::int n, count(*) filter (where is_late)::int late, count(*) filter (where status='absent')::int absent from attendance_records`)
    expect(r.rows[0].n).toBeGreaterThan(50)
    expect(r.rows[0].late).toBeGreaterThan(0)
  })
  it('locked last month payroll and published payslips', async () => {
    const r = await db.query<any>(`select status, employee_count, total_net::float net from payroll_runs`)
    expect(r.rows[0].status).toBe('locked')
    expect(r.rows[0].employee_count).toBeGreaterThan(5)
    const ps = await db.query<any>(`select count(*)::int n from payslips`)
    expect(ps.rows[0].n).toBe(r.rows[0].employee_count)
  })
  it('applied sick leave approval to the ledger', async () => {
    const r = await db.query<any>(`select la.status, (select used::float from leave_balances b where b.employee_id = la.employee_id and b.leave_type_id = la.leave_type_id) used
      from leave_applications la where la.employee_id = $1`, [EMP.field])
    expect(r.rows[0].status).toBe('approved')
    expect(r.rows[0].used).toBe(1)
  })
})

describe('payroll maths', () => {
  it('net = gross - deductions and PF respects the wage ceiling', async () => {
    const r = await db.query<any>(`select pe.gross_earnings::float g, pe.total_deductions::float d, pe.net_pay::float n,
        (select amount::float from payroll_entry_lines where entry_id = pe.id and component_code='PF') pf,
        (select amount::float from payroll_entry_lines where entry_id = pe.id and component_code='BASIC') basic,
        pe.lop_days::float lop
      from payroll_entries pe where employee_id = $1`, [EMP.admin])
    const row = r.rows[0]
    expect(row.n).toBeCloseTo(row.g - row.d, 2)
    expect(row.pf).toBe(1800) // 12% of 15000 ceiling
    const lines = await db.query<any>(`select sum(amount)::float s from payroll_entry_lines l join payroll_entries pe on pe.id = l.entry_id
      where pe.employee_id = $1 and l.line_type='deduction'`, [EMP.admin])
    expect(lines.rows[0].s).toBeCloseTo(row.d, 2)
  })
  it('ESI applies only under the threshold', async () => {
    const r = await db.query<any>(`select e.employee_code, exists (select 1 from payroll_entry_lines l where l.entry_id = pe.id and l.component_code='ESI') esi, pe.monthly_gross::float mg
      from payroll_entries pe join employees e on e.id = pe.employee_id`)
    for (const row of r.rows) if (row.mg > 21000) expect(row.esi).toBe(false)
    expect(r.rows.some((x: any) => x.esi)).toBe(true)
  })
  it('locked payroll cannot be edited without reopening', async () => {
    await expect(db.query(`update payroll_entries set net_pay = 1 where employee_id = $1`, [EMP.admin])).rejects.toThrow(/locked/)
  })
  it('reopen requires payroll.manage and a reason, and is audited', async () => {
    const run = (await db.query<any>(`select id from payroll_runs limit 1`)).rows[0].id
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select reopen_payroll_run($1, 'x')`, [run])).rejects.toThrow(/Only payroll administrators/)
    })
    await asUser(db, USERS.finance, async (q) => {
      await expect(q(`select reopen_payroll_run($1, '')`, [run])).rejects.toThrow(/reason/)
      await q(`select reopen_payroll_run($1, 'Correct arrears')`, [run])
    })
    const r = await db.query<any>(`select status, reopened_count from payroll_runs where id = $1`, [run])
    expect(r.rows[0].status).toBe('calculated')
    const a = await db.query<any>(`select count(*)::int n from audit_logs where action = 'PAYROLL_REOPEN'`)
    expect(a.rows[0].n).toBe(1)
    const loan = await db.query<any>(`select outstanding::float o from employee_loans`)
    expect(loan.rows[0].o).toBe(30000) // recovery reversed
  })
})

describe('leave engine', () => {
  it('blocks overlapping applications and insufficient balance', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const pending = await q<any>(`select start_date from leave_applications where employee_id = $1 and status = 'pending'`, [EMP.employee])
      const d = pending[0].start_date
      await expect(q(`select apply_leave('80000000-0000-4000-a000-000000000001', $1::date, $1::date, false, null, 'again', null)`, [d])).rejects.toThrow(/already have leave/)
      await expect(q(`select apply_leave('80000000-0000-4000-a000-000000000001', current_date + 30, current_date + 90, false, null, 'long trip', null)`)).rejects.toThrow(/Insufficient/)
      await expect(q(`select apply_leave('80000000-0000-4000-a000-000000000007', current_date + 30, current_date + 31, false, null, 'x', null)`)).rejects.toThrow(/not applicable/)
    })
  })
  it('sick leave beyond 2 days requires a document', async () => {
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select apply_leave('80000000-0000-4000-a000-000000000002', d, d + 6, false, null, 'surgery', null)
        from (select (current_date + 40)::date d) x`)).rejects.toThrow(/document/)
    })
  })
  it('employee cannot approve own request; manager approves step 1, HR step 2, balance debits once', async () => {
    const before = await db.query<any>(`select balance::float b from leave_balances where employee_id = $1 and leave_type_id = '80000000-0000-4000-a000-000000000001'`, [EMP.employee])
    await asUser(db, USERS.employee, async (q) => {
      const t = await q(`select * from my_approval_tasks where task_status = 'pending'`)
      expect(t.length).toBe(0)
    })
    await asUser(db, USERS.manager, async (q) => {
      const [t] = await q<any>(`select task_id from my_approval_tasks where entity_type='leave' and task_status='pending' and requester_employee_id = $1`, [EMP.employee])
      await expect(q(`select act_on_approval($1, 'reject', '')`, [t.task_id])).rejects.toThrow(/reason is required/)
      expect((await q<any>(`select act_on_approval($1, 'approve', 'ok') r`, [t.task_id]))[0].r).toBe('advanced')
    })
    await asUser(db, USERS.hr, async (q) => {
      const [t] = await q<any>(`select task_id from my_approval_tasks where entity_type='leave' and task_status='pending' and requester_employee_id = $1`, [EMP.employee])
      expect((await q<any>(`select act_on_approval($1, 'approve', null) r`, [t.task_id]))[0].r).toBe('approved')
    })
    const after = await db.query<any>(`select balance::float b from leave_balances where employee_id = $1 and leave_type_id = '80000000-0000-4000-a000-000000000001'`, [EMP.employee])
    const la = await db.query<any>(`select days::float d, status from leave_applications where employee_id = $1 and leave_type_id = '80000000-0000-4000-a000-000000000001'`, [EMP.employee])
    expect(la.rows[0].status).toBe('approved')
    expect(after.rows[0].b).toBeCloseTo(before.rows[0].b - la.rows[0].d, 1)
  })
  it('cancelling approved future leave credits the balance back', async () => {
    const id = (await db.query<any>(`select id from leave_applications where employee_id = $1 and status='approved' and start_date > current_date`, [EMP.employee])).rows[0].id
    const before = (await db.query<any>(`select balance::float b from leave_balances where employee_id = $1 and leave_type_id = '80000000-0000-4000-a000-000000000001'`, [EMP.employee])).rows[0].b
    await asUser(db, USERS.employee, (q) => q(`select cancel_leave($1, 'plans changed')`, [id]))
    const after = (await db.query<any>(`select balance::float b from leave_balances where employee_id = $1 and leave_type_id = '80000000-0000-4000-a000-000000000001'`, [EMP.employee])).rows[0].b
    expect(after).toBeGreaterThan(before)
  })
  it('accrual is idempotent per month', async () => {
    await asUser(db, USERS.hr, async (q) => {
      const [a] = await q<any>(`select run_leave_accrual(current_org_id()) n`)
      const [b] = await q<any>(`select run_leave_accrual(current_org_id()) n`)
      expect(a.n).toBeGreaterThan(0)
      expect(b.n).toBe(0)
    })
  })
})

describe('attendance rules', () => {
  it('grace period: 9 minutes late is on time, 11 minutes is late', async () => {
    const d = (await db.query<any>(`select g::date d from generate_series(current_date - 40, current_date - 30, interval '1 day') g
      where extract(dow from g) between 1 and 5 and not exists (select 1 from holidays h where h.holiday_date = g::date) limit 2`)).rows
    await asUser(db, USERS.hr, async (q) => {
      await q(`select manual_attendance($1, $2::date, '09:39', '18:35', 'test')`, [EMP.meena, d[0].d])
      await q(`select manual_attendance($1, $2::date, '09:41', '18:35', 'test')`, [EMP.meena, d[1].d])
    })
    const r = await db.query<any>(`select work_date, is_late, late_minutes, status from attendance_records where employee_id = $1 and work_date = any($2::date[]) order by work_date`, [EMP.meena, [d[0].d, d[1].d]])
    expect(r.rows[0].is_late).toBe(false)
    expect(r.rows[1].is_late).toBe(true)
    expect(r.rows[1].late_minutes).toBe(11)
    expect(r.rows[0].status).toBe('present')
  })
  it('online punches are sequence-checked and offline replays are idempotent', async () => {
    await db.query(`update company_settings set face_required_for_clock = false`)
    await asUser(db, USERS.manager, async (q) => {
      await q(`select clock_event('in', null, null, 13.0987, 80.1623, 12, 'ok', 'c-1')`)
      await expect(q(`select clock_event('in')`)).rejects.toThrow(/already clocked in/)
      const [dup] = await q<any>(`select clock_event('in', null, null, null, null, null, null, 'c-1') r`)
      expect(dup.r.duplicate).toBe(true)
      const [out] = await q<any>(`select clock_event('out') r`)
      expect(out.r.event_type).toBe('out')
    })
    await db.query(`update company_settings set face_required_for_clock = true`)
  })
  it('GPS outside the geofence flags but never blocks', async () => {
    await db.query(`update company_settings set face_required_for_clock = false`)
    await asUser(db, USERS.field, async (q) => {
      const [r] = await q<any>(`select clock_event('auto', '70000000-0000-4000-a000-000000000003', null, 13.2, 80.4, 20, 'ok', 'geo-1') r`)
      expect(r.r.flagged).toBe(true)
      expect(r.r.within_geofence).toBe(false)
      const [r2] = await q<any>(`select clock_event('auto', null, null, null, null, null, 'denied', 'geo-2') r`)
      expect(r2.r.event_type).toBe('out')
    })
    await db.query(`update company_settings set face_required_for_clock = true`)
  })
  it('stale offline punches are rejected', async () => {
    await db.query(`update company_settings set face_required_for_clock = false`)
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select clock_event('in', null, null, null, null, null, null, 'old-1', now() - interval '10 days', true)`)).rejects.toThrow(/older than/)
    })
    await db.query(`update company_settings set face_required_for_clock = true`)
  })
  it('face is required when configured', async () => {
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select clock_event('in')`)).rejects.toThrow(/Face verification is required/)
    })
  })
})

describe('face recognition', () => {
  const model = 'human-faceres-v1'
  it('enrolment requires HR and minimum samples', async () => {
    const samples = JSON.stringify([0, 1, 2, 3, 4].map((i) => near(vec(7), 0.0005 * i)))
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select face_enrol($1, $2, $3::jsonb)`, [EMP.employee, model, samples])).rejects.toThrow(/Only HR/)
    })
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select face_enrol($1, $2, $3::jsonb)`, [EMP.employee, model, JSON.stringify([vec(7)])])).rejects.toThrow(/At least 5/)
      const [r] = await q<any>(`select face_enrol($1, $2, $3::jsonb) r`, [EMP.employee, model, samples])
      expect(r.r.samples).toBe(5)
    })
  })
  it('templates are never readable by clients', async () => {
    await asUser(db, USERS.hr, async (q) => {
      expect((await q(`select * from face_templates`)).length).toBe(0)
    })
  })
  it('matching face + liveness clocks in; another face is rejected; spoof is rejected', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const [bad] = await q<any>(`select face_clock($1, $2, 0.9, 0.9, true, 0.8) r`, [JSON.stringify(vec(99)), model])
      expect(bad.r.outcome).toBe('no_match')
      const [spoof] = await q<any>(`select face_clock($1, $2, 0.1, 0.9, true, 0.8) r`, [JSON.stringify(near(vec(7), 0.001)), model])
      expect(spoof.r.outcome).toBe('spoof_suspected')
      const [noch] = await q<any>(`select face_clock($1, $2, 0.9, 0.9, false, 0.8) r`, [JSON.stringify(near(vec(7), 0.001)), model])
      expect(noch.r.outcome).toBe('liveness_failed')
      const [ok] = await q<any>(`select face_clock($1, $2, 0.95, 0.92, true, 0.8, 'auto', null, null, null, null, null, null, 'face-1') r`, [JSON.stringify(near(vec(7), 0.001)), model])
      expect(ok.r.outcome).toBe('matched')
      expect(ok.r.event_type).toBe('in')
      expect(Number(ok.r.similarity)).toBeGreaterThan(0.9)
    })
    const logs = await db.query<any>(`select outcome from face_recognition_attempts where employee_id = $1`, [EMP.employee])
    expect(logs.rows.map((r: any) => r.outcome)).toEqual(expect.arrayContaining(['no_match', 'spoof_suspected', 'liveness_failed', 'matched']))
  })
  it('kiosk identifies the right employee 1:N', async () => {
    await asUser(db, USERS.hr, async (q) => {
      const s = JSON.stringify([0, 1, 2, 3, 4].map((i) => near(vec(31), 0.0004 * i)))
      await q(`select face_enrol($1, $2, $3::jsonb)`, [EMP.field, model, s])
    })
    await asUser(db, USERS.kiosk, async (q) => {
      const [r] = await q<any>(`select kiosk_identify_clock($1, $2, 0.9, 0.9, true, 0.8) r`, [JSON.stringify(near(vec(31), 0.0007)), model])
      expect(r.r.outcome).toBe('matched')
      expect(r.r.employee_id).toBe(EMP.field)
    })
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select kiosk_identify_clock($1, $2, 0.9, 0.9, true, 0.8)`, [JSON.stringify(vec(31)), model])).rejects.toThrow(/not a kiosk/)
    })
  })
  it('withdrawing consent deletes templates', async () => {
    await asUser(db, USERS.field, (q) => q(`select record_consent('biometric', false)`))
    const n = await db.query<any>(`select count(*)::int n from face_templates where employee_id = $1`, [EMP.field])
    expect(n.rows[0].n).toBe(0)
  })
})

describe('row level security', () => {
  it('employee sees only own salary and payslips', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const s = await q<any>(`select employee_id from employee_salary_assignments`)
      expect(new Set(s.map((r) => r.employee_id))).toEqual(new Set([EMP.employee]))
      const p = await q<any>(`select employee_id from payslips`)
      expect(p.every((r) => r.employee_id === EMP.employee)).toBe(true)
      expect((await q(`select * from employee_bank_details where employee_id <> $1`, [EMP.employee])).length).toBe(0)
      expect((await q(`select * from payroll_runs`)).length).toBe(0)
    })
  })
  it('manager sees team attendance but not team salary', async () => {
    await asUser(db, USERS.manager, async (q) => {
      const a = await q<any>(`select distinct employee_id from attendance_records`)
      expect(a.map((r) => r.employee_id)).toContain(EMP.employee)
      expect(a.map((r) => r.employee_id)).not.toContain(EMP.hr)
      const s = await q<any>(`select employee_id from employee_salary_assignments`)
      expect(s.every((r) => r.employee_id === EMP.manager)).toBe(true)
    })
  })
  it('employees cannot read other employees personal rows but can see the directory', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const rows = await q<any>(`select id from employees`)
      expect(rows.map((r) => r.id)).toEqual([EMP.employee])
      const dir = await q<any>(`select id, full_name from employee_directory`)
      expect(dir.length).toBeGreaterThan(5)
    })
  })
  it('employees cannot insert attendance or approve directly', async () => {
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`insert into attendance_events(organisation_id, employee_id, event_type, work_date, occurred_at, method) values (current_org_id(), $1, 'in', current_date, now(), 'web')`, [EMP.employee])).rejects.toThrow()
      await expect(q(`update leave_applications set status = 'approved'`)).resolves.toBeDefined()
      const r = await q<any>(`select count(*)::int n from leave_applications where status='approved' and employee_id = $1 and leave_type_id = '80000000-0000-4000-a000-000000000001'`, [EMP.employee])
      expect(r[0].n).toBe(0) // the update silently matched no rows (no update policy)
      await expect(q(`select _record_attendance_event($1,'in','web','online',null,null,null,null,null,null,null,null,null,null,null)`, [EMP.employee])).rejects.toThrow(/permission denied/)
      await expect(q(`select submit_for_approval('leave', gen_random_uuid(), $1, 'x')`, [EMP.employee])).rejects.toThrow(/permission denied/)
    })
  })
  it('employee cannot read the assessment answer key', async () => {
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select is_correct from assessment_options`)).rejects.toThrow(/permission denied/)
      const ok = await q(`select id, option_text from assessment_options`)
      expect(ok.length).toBeGreaterThan(0)
    })
  })
  it('audit logs restricted to admin.audit', async () => {
    await asUser(db, USERS.manager, async (q) => expect((await q(`select * from audit_logs`)).length).toBe(0))
    await asUser(db, USERS.admin, async (q) => expect((await q(`select * from audit_logs`)).length).toBeGreaterThan(0))
  })
})

describe('claims', () => {
  it('detects duplicate claims and enforces receipts', async () => {
    await asUser(db, USERS.field, async (q) => {
      const [c] = await q<any>(`insert into expense_claims(organisation_id, employee_id, category_id, title, expense_date, amount)
        select organisation_id, employee_id, category_id, 'Fuel again', expense_date, amount from expense_claims where title like 'Fuel%' returning id`)
      const [r] = await q<any>(`select submit_claim($1) r`, [c.id])
      expect(r.r.possible_duplicate).toBe(true)
      const [big] = await q<any>(`insert into expense_claims(organisation_id, employee_id, category_id, title, expense_date, amount)
        values (current_org_id(), $1, 'a0000000-0000-4000-a000-000000000001', 'Flight', current_date - 1, 9000) returning id`, [EMP.field])
      await expect(q(`select submit_claim($1)`, [big.id])).rejects.toThrow(/receipt is required/)
    })
  })
})

describe('learning', () => {
  it('quiz grading, completion and certificate', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const lessons = await q<any>(`select l.id from course_lessons l join course_modules m on m.id = l.module_id where m.course_id = 'e0000000-0000-4000-a000-000000000001'`)
      for (const l of lessons) await q(`select complete_lesson($1)`, [l.id])
      const qs = await q<any>(`select q.id, o.id oid, o.option_text from assessment_questions q join assessment_options o on o.question_id = q.id where q.assessment_id = 'e2000000-0000-4000-a000-000000000001'`)
      const wrong: Record<string, string> = {}
      const right: Record<string, string> = {}
      for (const r of qs) {
        if (/10 or more|90 days/.test(r.option_text)) right[r.id] = r.oid
        else wrong[r.id] = r.oid
      }
      const [w] = await q<any>(`select submit_assessment('e2000000-0000-4000-a000-000000000001', $1::jsonb) r`, [JSON.stringify(wrong)])
      expect(w.r.passed).toBe(false)
      const [p] = await q<any>(`select submit_assessment('e2000000-0000-4000-a000-000000000001', $1::jsonb) r`, [JSON.stringify(right)])
      expect(p.r.score).toBe(100)
      const [en] = await q<any>(`select status, progress from course_enrolments where course_id = 'e0000000-0000-4000-a000-000000000001' and employee_id = $1`, [EMP.employee])
      expect(en.status).toBe('completed')
      expect((await q(`select * from certificates`)).length).toBe(1)
    })
  })
})

describe('offboarding', () => {
  it('cannot complete while assets are issued and clearances pending', async () => {
    await asUser(db, USERS.hr, async (q) => {
      await expect(q(`select complete_offboarding('f0000000-0000-4000-a000-000000000001')`)).rejects.toThrow(/clear/)
    })
  })
})

describe('dashboard', () => {
  it('returns scoped summary', async () => {
    await asUser(db, USERS.hr, async (q) => {
      const [r] = await q<any>(`select dashboard_summary() s`)
      expect(r.s.total_employees).toBeGreaterThan(5)
      expect(r.s.attendance_trend.length).toBe(14)
    })
    await asUser(db, USERS.employee, async (q) => {
      await expect(q(`select dashboard_summary()`)).rejects.toThrow(/Not authorised/)
      const [h] = await q<any>(`select my_home() h`)
      expect(h.h.balances.length).toBeGreaterThan(0)
    })
  })
})
