// Invite, activate and deactivate users. Caller must hold the admin.users permission.
// Self-contained (no ../_shared import) so it can be pasted into the Supabase dashboard editor:
// Edge Functions › admin-users › Code › paste › Deploy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

type Body = {
  action: 'invite' | 'activate' | 'deactivate'
  email?: string; full_name?: string; employee_id?: string | null; roles?: string[]; user_id?: string
  site_url?: string // the app's own address, used for the link in the invite email
}

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

/** Where the invite link should land: SITE_URL secret if set, otherwise the app that made the request. */
function siteUrl(req: Request, body: Body) {
  const env = Deno.env.get('SITE_URL')
  if (env) return env.replace(/\/$/, '')
  const cand = body.site_url || req.headers.get('origin') || ''
  try {
    const u = new URL(cand)
    if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin
  } catch { /* fall through */ }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json({ error: 'Not signed in' }, 401)
  const { data: allowed, error: permErr } = await caller.rpc('has_permission', { p_code: 'admin.users' })
  if (permErr || !allowed) return json({ error: 'You need the admin.users permission' }, 403)
  const { data: org } = await caller.rpc('current_org_id')
  if (!org) return json({ error: 'Caller has no organisation' }, 403)
  const { data: callerIsSuper } = await caller.rpc('has_role', { p_code: 'super_admin' })

  let body: Body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  if (body.action === 'invite') {
    const email = (body.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400)
    if (body.employee_id) {
      const { data: emp } = await admin.from('employees').select('id, organisation_id, user_id').eq('id', body.employee_id).single()
      if (!emp || emp.organisation_id !== org) return json({ error: 'Employee not found in your organisation' }, 404)
      if (emp.user_id) return json({ error: 'This employee already has a login' }, 409)
    }
    const { data: existing } = await admin.from('user_profiles').select('id, organisation_id').eq('email', email).maybeSingle()
    if (existing) return json({ error: 'This email already has an account in HRMS. Use "Reset password" in User management instead.' }, 409)

    const codes = body.roles?.length ? body.roles : ['employee']
    if (codes.includes('super_admin') && !callerIsSuper) return json({ error: 'Only a super administrator can grant the super administrator role' }, 403)
    const { data: roles, error: rErr } = await admin.from('roles').select('id, code').eq('organisation_id', org).in('code', codes)
    if (rErr) return json({ error: rErr.message }, 400)
    const missing = codes.filter((c) => !(roles ?? []).some((r) => r.code === c))
    if (missing.length) return json({ error: `Unknown role: ${missing.join(', ')}` }, 400)

    const site = siteUrl(req, body)
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: site ? `${site}/reset-password` : undefined, data: { full_name: body.full_name ?? '' },
    })
    if (error) return json({ error: error.message, code: (error as { code?: string }).code ?? null }, 400)
    const uid = invited.user.id

    const steps = [
      await admin.from('user_profiles').upsert({ id: uid, organisation_id: org, email, full_name: body.full_name || email, is_active: true }),
      await admin.from('user_roles').upsert(roles!.map((r) => ({ user_id: uid, role_id: r.id, assigned_by: who.user!.id }))),
      body.employee_id ? await admin.from('employees').update({ user_id: uid }).eq('id', body.employee_id) : { error: null },
    ]
    const failed = steps.find((s) => s.error)
    if (failed?.error) {
      // do not leave a half-made account behind: the email went out but the person could not sign in properly
      await admin.auth.admin.deleteUser(uid)
      return json({ error: `The invite could not be completed (${failed.error.message}). Nothing was saved; please try again.` }, 400)
    }
    await admin.from('audit_logs').insert({ organisation_id: org, actor_id: who.user.id, action: 'USER_INVITE', table_name: 'user_profiles', record_id: uid, note: `${email} roles=${codes.join(',')}` })
    return json({ user_id: uid })
  }

  if (body.action === 'activate' || body.action === 'deactivate') {
    if (!body.user_id) return json({ error: 'user_id is required' }, 400)
    if (body.user_id === who.user.id) return json({ error: 'You cannot change your own account status' }, 400)
    const { data: prof } = await admin.from('user_profiles').select('organisation_id').eq('id', body.user_id).single()
    if (!prof || prof.organisation_id !== org) return json({ error: 'User not found' }, 404)
    const active = body.action === 'activate'
    if (!active) {
      const { data: supers } = await admin.from('user_roles').select('user_id, roles!inner(code, organisation_id), user_profiles!inner(is_active)')
        .eq('roles.code', 'super_admin').eq('roles.organisation_id', org).eq('user_profiles.is_active', true)
      const ids = (supers ?? []).map((r: { user_id: string }) => r.user_id)
      if (ids.includes(body.user_id)) {
        if (!callerIsSuper) return json({ error: 'Only a super administrator can deactivate a super administrator' }, 403)
        if (ids.length <= 1) return json({ error: 'You cannot deactivate the last active super administrator' }, 400)
      }
    }
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: active ? 'none' : '876000h' })
    if (error) return json({ error: error.message }, 400)
    const { error: pErr } = await admin.from('user_profiles').update({ is_active: active }).eq('id', body.user_id)
    if (pErr) return json({ error: pErr.message }, 400)
    await admin.from('audit_logs').insert({ organisation_id: org, actor_id: who.user.id, action: active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', table_name: 'user_profiles', record_id: body.user_id })
    return json({ ok: true })
  }
  return json({ error: 'Unknown action' }, 400)
})
