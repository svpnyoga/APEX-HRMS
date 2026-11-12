import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser } from './harness'

// A fresh installation: no seed, no accounts.
let db: PGlite
const ids = {
  founder: 'a0000000-0000-4000-a000-000000000001',
  worker: 'a0000000-0000-4000-a000-000000000002',
  hr: 'a0000000-0000-4000-a000-000000000003',
  sneaky: 'a0000000-0000-4000-a000-000000000004',
  unconfirmed: 'a0000000-0000-4000-a000-000000000005',
  outsider: 'a0000000-0000-4000-a000-000000000006',
  rival: 'a0000000-0000-4000-a000-000000000007',
  admin2: 'a0000000-0000-4000-a000-000000000008',
}
let joinCode = ''

async function signUp(id: string, email: string, confirmed = true) {
  await db.query(
    `insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
     values ($1, 'authenticated', 'authenticated', $2, 'x', ${confirmed ? 'now()' : 'null'}, '{}', now(), now())`,
    [id, email],
  )
}
const one = async <T = any>(q: (s: string, p?: unknown[]) => Promise<any[]>, sql: string, p?: unknown[]) => Object.values((await q(sql, p))[0])[0] as T

beforeAll(async () => {
  db = await createDb({ seed: false })
  for (const [k, id] of Object.entries(ids)) await signUp(id, `${k}@acme.test`, k !== 'unconfirmed')
})

describe('fresh installation', () => {
  it('has no accounts and offers company creation', async () => {
    expect((await db.query<any>(`select count(*)::int n from user_profiles`)).rows[0].n).toBe(0)
    await db.exec(`set role anon`)
    const r = await db.query<any>(`select signup_options() o`)
    await db.exec(`reset role`)
    expect(r.rows[0].o.can_create_organisation).toBe(true)
  })

  it('anonymous visitors cannot call any other RPC', async () => {
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select request_access('X', 'Y')`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select get_my_access()`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select create_organisation_account('A', 'B')`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })

  it('refuses an unconfirmed email', async () => {
    await asUser(db, ids.unconfirmed, async (q) => {
      await expect(q(`select create_organisation_account('Nope Ltd', 'Un Confirmed')`)).rejects.toThrow(/confirm your email/)
    })
  })

  it('the first sign-up creates the company and becomes super administrator with an employee record', async () => {
    await asUser(db, ids.founder, async (q) => {
      const r = await one<any>(q, `select create_organisation_account('Acme Tools', 'Fiona Founder', '+91 90000 00000', 'Pune', 'Maharashtra')`)
      expect(r.ok).toBe(true)
      const a = await one<any>(q, `select get_my_access()`)
      expect(a.roles).toEqual(expect.arrayContaining(['super_admin', 'employee']))
      expect(a.active).toBe(true)
      expect(a.employee_id).toBeTruthy()
      const e = (await q(`select first_name, last_name, employee_code from employees where user_id = $1`, [ids.founder]))[0]
      expect(e).toMatchObject({ first_name: 'Fiona', last_name: 'Founder' })
      expect(e.employee_code).toMatch(/^EMP/)
      joinCode = await one<string>(q, `select join_code from signup_settings`)
      expect(joinCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    })
  })

  it('a second company cannot be created', async () => {
    await asUser(db, ids.rival, async (q) => {
      await expect(q(`select create_organisation_account('Rival Co', 'Rob Rival')`)).rejects.toThrow(/closed/)
      expect((await one<any>(q, `select my_signup_status()`)).can_create_organisation).toBe(false)
    })
  })

  it('join codes are unique and random', async () => {
    const r = await db.query<any>(`select count(distinct public.new_join_code())::int n from generate_series(1, 500)`)
    expect(r.rows[0].n).toBe(500)
  })
})

describe('joining a company', () => {
  it('a wrong code is refused and rate limited after five tries', async () => {
    await asUser(db, ids.sneaky, async (q) => {
      for (let i = 0; i < 5; i++) {
        const r = await one<any>(q, `select request_access('AAAA-BBBB-CCC${i}', 'Sneaky Pete')`)
        expect(r).toMatchObject({ ok: false })
        expect(r.error).toMatch(/not valid/)
      }
      // even the right code is refused once locked out
      const r = await one<any>(q, `select request_access($1, 'Sneaky Pete')`, [joinCode])
      expect(r.error).toMatch(/Too many/)
    })
  })

  it('a pending account sees no data at all', async () => {
    await asUser(db, ids.worker, async (q) => {
      const r = await one<any>(q, `select request_access($1, 'Wendy Worker', 'employee', null, 'Machinist', 'Shop floor, shift B')`, [joinCode.toLowerCase().replace(/-/g, ' ')])
      expect(r).toMatchObject({ ok: true, organisation_name: 'Acme Tools' })
      const a = await one<any>(q, `select get_my_access()`)
      expect(a.organisation_id).toBeNull()
      expect(a.permissions).toEqual([])
      expect(await q(`select * from employees`)).toHaveLength(0)
      expect(await q(`select * from user_profiles`)).toHaveLength(0)
      expect(await q(`select * from signup_settings`)).toHaveLength(0)
      expect((await one<any>(q, `select my_signup_status()`)).request.status).toBe('pending')
      await expect(q(`insert into user_profiles(id, organisation_id, email) select $1, organisation_id, 'x' from access_requests`, [ids.worker])).rejects.toThrow()
      await expect(q(`update access_requests set status = 'approved'`)).rejects.toThrow(/permission denied/)
    })
  })

  it('administrators are notified of a new request', async () => {
    const r = await db.query<any>(`select title, link from notifications where user_id = $1`, [ids.founder])
    expect(r.rows.some((n: any) => /Wendy Worker/.test(n.title) && n.link === '/admin/users?tab=requests')).toBe(true)
  })

  it('rejecting needs a reason; the person can resubmit', async () => {
    await asUser(db, ids.founder, async (q) => {
      const id = await one<string>(q, `select id from access_requests where user_id = $1`, [ids.worker])
      await expect(q(`select decide_access_request($1, false)`, [id])).rejects.toThrow(/reason/)
      await q(`select decide_access_request($1, false, null, null, true, 'Please use your full legal name')`, [id])
    })
    await asUser(db, ids.worker, async (q) => {
      expect((await one<any>(q, `select my_signup_status()`)).request).toMatchObject({ status: 'rejected', decision_note: 'Please use your full legal name' })
      expect((await one<any>(q, `select request_access($1, 'Wendy Anne Worker', 'field_employee')`, [joinCode])).ok).toBe(true)
    })
  })

  it('approval creates the profile, roles and employee record', async () => {
    await asUser(db, ids.founder, async (q) => {
      const id = await one<string>(q, `select id from access_requests where user_id = $1`, [ids.worker])
      const r = await one<any>(q, `select decide_access_request($1, true, array['field_employee','employee'])`, [id])
      expect(r.status).toBe('approved')
      await expect(q(`select decide_access_request($1, true)`, [id])).rejects.toThrow(/already been approved/)
    })
    await asUser(db, ids.worker, async (q) => {
      const a = await one<any>(q, `select get_my_access()`)
      expect(a.roles.sort()).toEqual(['employee', 'field_employee'])
      expect(a.active).toBe(true)
      const e = (await q(`select first_name, last_name, is_field_employee from employees where id = $1`, [a.employee_id]))[0]
      expect(e).toMatchObject({ first_name: 'Wendy', last_name: 'Anne Worker', is_field_employee: true })
      // an ordinary employee cannot read the join code
      expect(await q(`select * from signup_settings`)).toHaveLength(0)
      await expect(q(`select rotate_join_code()`)).rejects.toThrow(/Not authorised/)
    })
  })

  it('an HR administrator cannot create a super administrator', async () => {
    await asUser(db, ids.hr, async (q) => {
      expect((await one<any>(q, `select request_access($1, 'Harini HR', 'hr_admin')`, [joinCode])).ok).toBe(true)
    })
    await asUser(db, ids.admin2, async (q) => {
      expect((await one<any>(q, `select request_access($1, 'Arun Admin', 'super_admin')`, [joinCode])).ok).toBe(true)
    })
    await asUser(db, ids.founder, async (q) => {
      const id = await one<string>(q, `select id from access_requests where user_id = $1`, [ids.hr])
      await q(`select decide_access_request($1, true, array['hr_admin','employee'])`, [id])
    })
    await asUser(db, ids.hr, async (q) => {
      const id = await one<string>(q, `select id from access_requests where user_id = $1`, [ids.admin2])
      await expect(q(`select decide_access_request($1, true, array['super_admin'])`, [id])).rejects.toThrow(/Only a super administrator/)
      // approve as an ordinary employee is fine
      await q(`select decide_access_request($1, true, array['employee'])`, [id])
      // and a direct write to user_roles is blocked too
      await expect(q(`insert into user_roles(user_id, role_id) select $1, id from roles where code = 'super_admin'`, [ids.hr])).rejects.toThrow(/Only a super administrator/)
      await expect(q(`insert into user_roles(user_id, role_id) select $1, id from roles where code = 'super_admin'`, [ids.admin2])).rejects.toThrow(/Only a super administrator/)
      // nor can HR remove or deactivate the founder
      await expect(q(`delete from user_roles where user_id = $1`, [ids.founder])).rejects.toThrow(/Only a super administrator/)
      await expect(q(`update user_profiles set is_active = false where id = $1`, [ids.founder])).rejects.toThrow(/Only a super administrator/)
      // nor give a role full access
      await expect(q(`insert into role_permissions(role_id, permission_code) select id, '*' from roles where code = 'hr_admin'`)).rejects.toThrow(/full-access/)
      // HR can read the join code and rotate it
      expect(await q(`select join_code from signup_settings`)).toHaveLength(1)
    })
  })

  it('the last super administrator cannot be removed', async () => {
    await asUser(db, ids.founder, async (q) => {
      await expect(q(`delete from user_roles where user_id = $1 and role_id = (select id from roles where code = 'super_admin')`, [ids.founder])).rejects.toThrow(/last active super administrator/)
      // a super admin may grant the role, after which the founder can step down
      await q(`insert into user_roles(user_id, role_id) select $1, id from roles where code = 'super_admin'`, [ids.admin2])
      await q(`delete from user_roles where user_id = $1 and role_id = (select id from roles where code = 'super_admin')`, [ids.founder])
    })
  })

  it('email domains and the sign-up switch are enforced', async () => {
    await asUser(db, ids.admin2, async (q) => {
      await q(`update signup_settings set allowed_email_domains = array['@Acme-Tools.com ', '']`)
      expect(await one(q, `select allowed_email_domains from signup_settings`)).toEqual(['acme-tools.com'])
      await expect(q(`update signup_settings set join_code = 'AAAA-AAAA-AAAA'`)).rejects.toThrow(/permission denied/)
    })
    await asUser(db, ids.outsider, async (q) => {
      const r = await one<any>(q, `select request_access($1, 'Olly Outsider')`, [joinCode])
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/@acme-tools\.com/)
    })
    await asUser(db, ids.admin2, async (q) => {
      await q(`update signup_settings set allowed_email_domains = '{}', signup_enabled = false`)
    })
    await asUser(db, ids.outsider, async (q) => {
      expect((await one<any>(q, `select request_access($1, 'Olly Outsider')`, [joinCode])).error).toMatch(/not accepting/)
    })
  })

  it('rotating the code invalidates the old one', async () => {
    let fresh = ''
    await asUser(db, ids.admin2, async (q) => {
      await q(`update signup_settings set signup_enabled = true`)
      fresh = await one<string>(q, `select rotate_join_code()`)
    })
    expect(fresh).not.toBe(joinCode)
    await asUser(db, ids.outsider, async (q) => {
      expect((await one<any>(q, `select request_access($1, 'Olly Outsider')`, [joinCode])).error).toMatch(/not valid/)
      expect((await one<any>(q, `select request_access($1, 'Olly Outsider')`, [fresh])).ok).toBe(true)
    })
  })

  it('the operator can allow more companies', async () => {
    await db.query(`update platform_settings set allow_new_organisations = true`)
    await asUser(db, ids.rival, async (q) => {
      expect((await one<any>(q, `select create_organisation_account('Rival Co', 'Rob Rival')`)).ok).toBe(true)
      // tenants are isolated
      const names = (await q(`select name from organisations`)).map((r) => r.name)
      expect(names).toEqual(['Rival Co'])
      expect(await q(`select * from access_requests where organisation_id <> (select current_org_id())`)).toHaveLength(0)
    })
  })
})
