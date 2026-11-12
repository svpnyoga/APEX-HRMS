// Invite, activate and deactivate users. Caller must hold the admin.users permission.
import { cors, json, serviceClient, userClient } from '../_shared/util.ts'

type Body = { action: 'invite' | 'activate' | 'deactivate'; email?: string; full_name?: string; employee_id?: string | null; roles?: string[]; user_id?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const caller = userClient(req)
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json({ error: 'Not signed in' }, 401)
  const { data: allowed, error: permErr } = await caller.rpc('has_permission', { p_code: 'admin.users' })
  if (permErr || !allowed) return json({ error: 'You need the admin.users permission' }, 403)
  const { data: org } = await caller.rpc('current_org_id')
  if (!org) return json({ error: 'Caller has no organisation' }, 403)

  const { data: callerIsSuper } = await caller.rpc('has_role', { p_code: 'super_admin' })

  let body: Body
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }
  const admin = serviceClient()

  if (body.action === 'invite') {
    const email = (body.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400)
    if (body.employee_id) {
      const { data: emp } = await admin.from('employees').select('id, organisation_id, user_id').eq('id', body.employee_id).single()
      if (!emp || emp.organisation_id !== org) return json({ error: 'Employee not found in your organisation' }, 404)
      if (emp.user_id) return json({ error: 'This employee already has a login' }, 409)
    }
    const codes = body.roles?.length ? body.roles : ['employee']
    if (codes.includes('super_admin') && !callerIsSuper) return json({ error: 'Only a super administrator can grant the super administrator role' }, 403)
    const redirectTo = `${Deno.env.get('SITE_URL') ?? ''}/reset-password`
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: body.full_name ?? '' } })
    if (error) return json({ error: error.message }, 400)
    const uid = invited.user.id
    const { error: pErr } = await admin.from('user_profiles').upsert({ id: uid, organisation_id: org, email, full_name: body.full_name || email, is_active: true })
    if (pErr) return json({ error: pErr.message }, 400)
    const { data: roles } = await admin.from('roles').select('id, code').eq('organisation_id', org).in('code', codes)
    if (roles?.length) await admin.from('user_roles').upsert(roles.map((r) => ({ user_id: uid, role_id: r.id, assigned_by: who.user!.id })))
    if (body.employee_id) await admin.from('employees').update({ user_id: uid }).eq('id', body.employee_id)
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
    await admin.from('user_profiles').update({ is_active: active }).eq('id', body.user_id)
    await admin.from('audit_logs').insert({ organisation_id: org, actor_id: who.user.id, action: active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', table_name: 'user_profiles', record_id: body.user_id })
    return json({ ok: true })
  }
  return json({ error: 'Unknown action' }, 400)
})
