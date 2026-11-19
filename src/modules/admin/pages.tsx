import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, MailPlus, Plus, Save, ShieldCheck, Trash2, UserCog, Ban, Database, Send } from 'lucide-react'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { adminUsers } from '@/lib/admin-users'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { exportExcel, download } from '@/lib/export'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, QueryView, StatStrip } from '@/components/common/page'
import { EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { CrudPage } from '@/components/crud/CrudPage'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { cn, errorMessage, fmtDate, fmtDateTime, titleCase, ago } from '@/lib/utils'
import { SettingsForm } from './settings'
import { ENTITY_LABEL } from '@/modules/approvals/Inbox'


/** PostgREST returns the linked employee as an object (one-to-one) — older code expected an array. */
const linkedEmployee = (u: any) => (Array.isArray(u?.employees) ? u.employees[0] : u?.employees) ?? null

/** The People tab of User management (see ./access.tsx for the page). */
export function UsersListPage() {
  const confirm = useConfirm()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => unwrap<any[]>(db.from('user_profiles').select('*, user_roles(role_id, roles(code, name)), employees(id, employee_code, first_name, last_name)').order('full_name')) })
  const roles = useLookup<any>('roles', 'id, code, name', 'name')
  const [invite, setInvite] = useState(false)
  const [edit, setEdit] = useState<any | null>(null)
  const toggle = useAction(({ id, active }: { id: string; active: boolean }) => adminUsers({ action: active ? 'activate' : 'deactivate', user_id: id }), { success: 'User updated', invalidate: [['admin', 'users']] })
  const reset = useAction((email: string) => supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` }).then(({ error }) => { if (error) throw error }), { success: 'Password reset email sent' })
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Sign-in accounts, their roles and the employee record they are linked to.</p>
        <Button onClick={() => setInvite(true)}><MailPlus /> Invite user</Button>
      </div>
      <DataTable rows={users.data} loading={users.isLoading} error={users.error} exportName="Users" onRowClick={setEdit} columns={[
        { key: 'full_name', header: 'User', cell: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted">{r.email}</div></div>, value: (r) => `${r.full_name} ${r.email}` },
        { key: 'roles', header: 'Roles', value: (r) => r.user_roles?.map((x: any) => x.roles?.name).join(', '), cell: (r) => <div className="flex flex-wrap gap-1">{r.user_roles?.map((x: any) => <Badge key={x.role_id} tone="primary">{x.roles?.name}</Badge>)}</div> },
        { key: 'employee', header: 'Employee', value: (r) => { const e = linkedEmployee(r); return e ? `${e.first_name} ${e.last_name} (${e.employee_code})` : 'Not linked' } },
        { key: 'is_active', header: 'Status', cell: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
        { key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" onClick={() => reset.mutate(r.email)}>Reset password</Button>
            <Button size="sm" variant="ghost" onClick={async () => { if ((await confirm({ title: `${r.is_active ? 'Deactivate' : 'Reactivate'} ${r.full_name}?`, danger: r.is_active })).ok) toggle.mutate({ id: r.id, active: !r.is_active }) }}><Ban /> {r.is_active ? 'Deactivate' : 'Reactivate'}</Button>
          </div>
        ) },
      ]} />
      {invite && <InviteDialog roles={roles.data ?? []} onClose={() => setInvite(false)} />}
      {edit && <UserRolesDrawer user={edit} roles={roles.data ?? []} onClose={() => setEdit(null)} />}
    </div>
  )
}

function InviteDialog({ roles: allRoles, onClose }: { roles: any[]; onClose: () => void }) {
  const { access } = useAuth()
  const roles = allRoles.filter((r) => r.code !== 'super_admin' || access?.roles.includes('super_admin'))
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [emp, setEmp] = useState<string | null>(null); const [sel, setSel] = useState<string[]>(['employee'])
  const send = useAction(() => adminUsers({ action: 'invite', email, full_name: name, employee_id: emp, roles: sel }), { success: 'Invitation sent', invalidate: [['admin', 'users'], ['directory']], onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Invite a user" description="They receive an email to set a password. Linking an employee gives them self-service." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={send.isPending} disabled={!email || !sel.length} onClick={() => send.mutate()}><Send /> Send invite</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Link to employee" className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} allowClear filter={(e: any) => !e.user_id} /></Field>
        <Field label="Roles" className="sm:col-span-2"><div className="flex flex-wrap gap-1.5">{roles.map((r) => <button key={r.id} type="button" onClick={() => setSel(sel.includes(r.code) ? sel.filter((x) => x !== r.code) : [...sel, r.code])} className={cn('rounded-md border px-2.5 py-1 text-sm', sel.includes(r.code) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>{r.name}</button>)}</div></Field>
      </div>
    </Dialog>
  )
}

function UserRolesDrawer({ user, roles, onClose }: { user: any; roles: any[]; onClose: () => void }) {
  const { access } = useAuth()
  const isSuper = !!access?.roles.includes('super_admin')
  const current = new Set<string>((user.user_roles ?? []).map((r: any) => r.role_id))
  const [sel, setSel] = useState<Set<string>>(current)
  const linked: string | null = linkedEmployee(user)?.id ?? null
  const [emp, setEmp] = useState<string | null>(linked)
  const save = useAction(async () => {
    if (emp !== linked) await rpc('link_user_employee', { p_user: user.id, p_employee: emp })
    const add = [...sel].filter((r) => !current.has(r)), remove = [...current].filter((r) => !sel.has(r))
    if (add.length) await unwrap(db.from('user_roles').insert(add.map((role_id) => ({ user_id: user.id, role_id }))).select('user_id'))
    for (const r of remove) await unwrap(db.from('user_roles').delete().eq('user_id', user.id).eq('role_id', r).select('user_id'))
  }, { success: 'User updated', invalidate: [['admin', 'users'], ['directory'], ['access']], onSuccess: onClose })
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={user.full_name} description={user.email} footer={<Button loading={save.isPending} onClick={() => save.mutate()}><Save /> Save</Button>}>
      <Field label="Linked employee" hint="Links this login to an employee record, so the person gets their own leave, claims, payslips and appraisals." className="mb-5">
        <EmployeePicker value={emp} onChange={setEmp} allowClear filter={(e: any) => !e.user_id || e.id === linked} />
      </Field>
      <h4 className="mb-2 text-sm font-semibold">Roles</h4>
      <div className="space-y-2">{roles.map((r) => (
        <label key={r.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2.5 text-sm"><span><span className="font-medium">{r.name}</span><span className="block text-xs text-muted">{r.code}</span></span>
          <Switch checked={sel.has(r.id)} disabled={r.code === 'super_admin' && !isSuper} onCheckedChange={(on) => { const s = new Set(sel); on ? s.add(r.id) : s.delete(r.id); setSel(s) }} /></label>
      ))}</div>
      <p className="mt-4 text-xs text-muted">Role changes take effect on the user’s next page load. All changes are audited.{!isSuper && ' Only a super administrator can grant or remove the super administrator role.'}</p>
    </Drawer>
  )
}

export function RolesPage() {
  const { can } = useAuth()
  const { orgId } = useMe()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: () => unwrap<any[]>(db.from('roles').select('*, role_permissions(permission_code)').order('name')) })
  const perms = useQuery({ queryKey: ['admin', 'perms'], queryFn: () => unwrap<any[]>(db.from('permissions').select('*').neq('code', '*').order('module').order('code')) })
  const [role, setRole] = useState<string>('')
  const [newRole, setNewRole] = useState(false)
  const r = (roles.data ?? []).find((x) => x.id === role) ?? roles.data?.[0]
  const has = new Set<string>((r?.role_permissions ?? []).map((p: any) => p.permission_code))
  const toggle = useAction(async ({ code, on }: { code: string; on: boolean }) => {
    if (on) await unwrap(db.from('role_permissions').insert({ role_id: r.id, permission_code: code }).select('role_id'))
    else await unwrap(db.from('role_permissions').delete().eq('role_id', r.id).eq('permission_code', code).select('role_id'))
  }, { invalidate: [['admin', 'roles']] })
  const create = useAction(async ({ code, name, copy }: { code: string; name: string; copy: string }) => {
    const [nr] = await unwrap<any[]>(db.from('roles').insert({ organisation_id: orgId, code, name }).select('id'))
    const src = (roles.data ?? []).find((x) => x.id === copy)
    if (src?.role_permissions?.length) await unwrap(db.from('role_permissions').insert(src.role_permissions.filter((p: any) => p.permission_code !== '*').map((p: any) => ({ role_id: nr.id, permission_code: p.permission_code }))).select('role_id'))
    return nr.id
  }, { success: 'Role created', invalidate: [['admin', 'roles'], ['lookup', 'roles']], onSuccess: (id) => { setRole(id); setNewRole(false) } })
  const modules = useMemo(() => [...new Set((perms.data ?? []).map((p) => p.module))], [perms.data])
  const editable = can('admin.roles') && r && !has.has('*')
  const [nv, setNv] = useState({ code: '', name: '', copy: '' })
  return (
    <div>
      <PageHeader title="Roles & permissions" description="Permissions are enforced in the database (row-level security and function checks), not only by hiding buttons. ‘View’ = organisation-wide; ‘view team’ = reporting line only."
        actions={can('admin.roles') && <Button onClick={() => setNewRole(true)}><Plus /> New role</Button>} />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-2">{(roles.data ?? []).map((x) => (
          <button key={x.id} onClick={() => setRole(x.id)} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm', r?.id === x.id ? 'bg-primary-soft text-primary' : 'hover:bg-raised')}>
            <span>{x.name}</span><span className="text-xs text-subtle">{x.role_permissions?.some((p: any) => p.permission_code === '*') ? 'all' : x.role_permissions?.length}</span>
          </button>
        ))}</Card>
        <QueryView q={perms}>
          {(ps) => (
            <Card>
              <CardHeader title={r?.name ?? ''} description={has.has('*') ? 'Super administrator — has every permission; cannot be edited.' : r?.description} />
              <div className="divide-y divide-line">
                {modules.map((m) => (
                  <div key={m} className="grid gap-2 px-5 py-3 sm:grid-cols-[160px_1fr]">
                    <div className="text-sm font-medium">{titleCase(m)}</div>
                    <div className="flex flex-wrap gap-1.5">{ps.filter((p) => p.module === m).map((p) => {
                      const on = has.has('*') || has.has(p.code)
                      return <button key={p.code} title={p.description} disabled={!editable || toggle.isPending} onClick={() => toggle.mutate({ code: p.code, on: !on })}
                        className={cn('rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-default', on ? 'border-primary bg-primary text-primary-fg' : 'border-line text-muted hover:bg-raised')}>{p.code.split('.')[1].replace('_', ' ')}</button>
                    })}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </QueryView>
      </div>
      <Dialog open={newRole} onOpenChange={setNewRole} title="New role" footer={<Button loading={create.isPending} disabled={!nv.code || !nv.name} onClick={() => create.mutate(nv)}>Create</Button>}>
        <div className="space-y-4">
          <Field label="Name" required><Input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} /></Field>
          <Field label="Code" required hint="Lowercase, no spaces"><Input value={nv.code} onChange={(e) => setNv({ ...nv, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} /></Field>
          <Field label="Copy permissions from"><Select value={nv.copy} onChange={(e) => setNv({ ...nv, copy: e.target.value })}><option value="">Start empty</option>{(roles.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function CompanyPage() {
  const q = useQuery({ queryKey: ['admin', 'org'], queryFn: () => unwrap<any>(db.from('organisations').select('*').single()) })
  const [v, setV] = useState<any>(null)
  const save = useAction(() => unwrap(db.from('organisations').update({ name: v.name, legal_name: v.legal_name, address: v.address, city: v.city, state: v.state, phone: v.phone, email: v.email, website: v.website, gstin: v.gstin, pan: v.pan, tan: v.tan, timezone: v.timezone }).eq('id', v.id).select('id')), { success: 'Company information saved', invalidate: [['admin', 'org']] })
  const data = v ?? q.data
  const f = (k: string, label: string, wide?: boolean) => <Field label={label} className={wide ? 'sm:col-span-2' : undefined}><Input value={data?.[k] ?? ''} onChange={(e) => setV({ ...(data ?? {}), [k]: e.target.value })} /></Field>
  return (
    <div className="space-y-5">
      <PageHeader title="Company information" description="Shown on payslips and documents." actions={<Button loading={save.isPending} disabled={!v} onClick={() => save.mutate()}><Save /> Save</Button>} />
      <QueryView q={q}>{() => (
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          {f('name', 'Display name')}{f('legal_name', 'Legal name')}{f('address', 'Address', true)}{f('city', 'City')}{f('state', 'State')}{f('phone', 'Phone')}{f('email', 'Email')}{f('website', 'Website')}{f('gstin', 'GSTIN')}{f('pan', 'PAN')}{f('tan', 'TAN')}
          <Field label="Time zone"><Select value={data?.timezone ?? 'Asia/Kolkata'} onChange={(e) => setV({ ...(data ?? {}), timezone: e.target.value })}>{['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        </Card>
      )}</QueryView>
    </div>
  )
}

export function OrganisationSettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Organisation settings" description="Locations and document types used across the system." />
      <CrudPage cfg={{ title: 'Locations', embedded: true, table: 'locations', permission: 'employees.manage', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
        columns: [{ key: 'name', header: 'Location' }, { key: 'city', header: 'City' }, { key: 'state', header: 'State' }, { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') }],
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'address', label: 'Address', type: 'text', wide: true }, { name: 'city', label: 'City', type: 'text' }, { name: 'state', label: 'State', type: 'text' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }] }} />
      <CrudPage cfg={{ title: 'Document types', embedded: true, table: 'document_types', permission: 'employees.manage', orderBy: { column: 'name' }, remove: 'delete',
        columns: [{ key: 'name', header: 'Document type' }, { key: 'is_mandatory_onboarding', header: 'Required at onboarding', value: (r) => (r.is_mandatory_onboarding ? 'Yes' : 'No') }],
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'is_mandatory_onboarding', label: 'Required at onboarding', type: 'switch' }] }} />
    </div>
  )
}

export const SettingsPage = ({ section, title }: { section: any; title: string }) => <div><PageHeader title={title} /><SettingsForm section={section} /></div>

export function ApprovalConfigPage() {
  const wfs = useQuery({ queryKey: ['admin', 'workflows'], queryFn: () => unwrap<any[]>(db.from('approval_workflows').select('*, approval_workflow_steps(*, roles!approval_workflow_steps_role_id_fkey(name))').order('entity_type')) })
  const [sel, setSel] = useState<any | null>(null)
  const toggle = useAction(({ id, on }: { id: string; on: boolean }) => unwrap(db.from('approval_workflows').update({ is_active: on }).eq('id', id).select('id')), { invalidate: [['admin', 'workflows']] })
  return (
    <div className="space-y-6">
      <PageHeader title="Approval configuration" description="One engine drives every approval. Steps run in order; a step with “all must approve” waits for every approver. Requesters never approve their own requests; unresolved steps fall back to HR." />
      <QueryView q={wfs}>{(d) => (
        <div className="grid gap-3 md:grid-cols-2">
          {d.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="flex items-center justify-between gap-2"><div><div className="font-semibold">{w.name}</div><div className="text-xs text-muted">{ENTITY_LABEL[w.entity_type] ?? w.entity_type}</div></div><Switch checked={w.is_active} onCheckedChange={(on) => toggle.mutate({ id: w.id, on })} /></div>
              <ol className="mt-3 space-y-1.5">{[...(w.approval_workflow_steps ?? [])].sort((a: any, b: any) => a.step_order - b.step_order).map((s: any) => (
                <li key={s.id} className="flex items-center gap-2 text-sm"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">{s.step_order}</span>{s.name}
                  <span className="text-xs text-muted">· {s.approver_type === 'role' ? s.roles?.name : titleCase(s.approver_type)}{s.mode === 'all' && ' · all must approve'}{s.min_amount && ` · above ₹${s.min_amount}`}{s.escalate_after_hours && ` · escalate after ${s.escalate_after_hours}h`}</span></li>
              ))}</ol>
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSel(w)}>Edit steps</Button>
            </Card>
          ))}
        </div>
      )}</QueryView>
      {sel && <Drawer open onOpenChange={(o) => !o && setSel(null)} title={sel.name} description="Steps are evaluated in order.">
        <CrudPage cfg={{
          title: 'Steps', embedded: true, table: 'approval_workflow_steps', select: '*, roles!approval_workflow_steps_role_id_fkey(name)', orgScoped: false, permission: 'admin.workflows', queryKey: ['admin', 'workflows', 'steps', sel.id],
          filter: (q) => q.eq('workflow_id', sel.id), orderBy: { column: 'step_order' }, remove: 'delete', transform: (v) => ({ ...v, workflow_id: sel.id }),
          columns: [{ key: 'step_order', header: '#' }, { key: 'name', header: 'Step' }, { key: 'approver', header: 'Approver', value: (r) => (r.approver_type === 'role' ? r.roles?.name : titleCase(r.approver_type)) }, { key: 'mode', header: 'Mode', value: (r) => (r.mode === 'all' ? 'All' : 'Any one') }],
          fields: [{ name: 'step_order', label: 'Order', type: 'number', min: 1, required: true, default: 1 }, { name: 'name', label: 'Step name', type: 'text', required: true },
            { name: 'approver_type', label: 'Approver', type: 'select', required: true, default: 'reporting_manager', options: ['reporting_manager', 'skip_level_manager', 'department_head', 'role', 'user'].map((v) => ({ value: v, label: titleCase(v) })) },
            { name: 'role_id', label: 'Role', type: 'lookup', lookup: { table: 'roles' }, showIf: (v) => v.approver_type === 'role' },
            { name: 'user_id', label: 'User', type: 'lookup', lookup: { table: 'user_profiles', label: 'full_name', order: 'full_name' }, showIf: (v) => v.approver_type === 'user' },
            { name: 'mode', label: 'Parallel approvers', type: 'select', required: true, default: 'any', options: [{ value: 'any', label: 'Any one approves' }, { value: 'all', label: 'All must approve' }] },
            { name: 'min_amount', label: 'Only when amount is at least (₹)', type: 'number', min: 0 }, { name: 'escalate_after_hours', label: 'Escalate after (hours)', type: 'number', min: 1 },
            { name: 'escalate_to_role_id', label: 'Escalate to role', type: 'lookup', lookup: { table: 'roles' } }],
        }} />
      </Drawer>}
      <CrudPage cfg={{
        title: 'Delegations', embedded: true, table: 'approval_delegations', select: '*, from:user_profiles!approval_delegations_from_user_id_fkey(full_name), to:user_profiles!approval_delegations_to_user_id_fkey(full_name)', permission: 'admin.workflows', remove: 'delete',
        columns: [{ key: 'from', header: 'From', value: (r) => r.from?.full_name }, { key: 'to', header: 'To', value: (r) => r.to?.full_name }, { key: 'period', header: 'Period', value: (r) => `${fmtDate(r.starts_on)} – ${fmtDate(r.ends_on)}` }, { key: 'entity_type', header: 'For', value: (r) => (r.entity_type ? ENTITY_LABEL[r.entity_type] : 'All requests') }],
        fields: [{ name: 'from_user_id', label: 'Delegate from', type: 'lookup', lookup: { table: 'user_profiles', label: 'full_name', order: 'full_name' }, required: true },
          { name: 'to_user_id', label: 'Delegate to', type: 'lookup', lookup: { table: 'user_profiles', label: 'full_name', order: 'full_name' }, required: true },
          { name: 'starts_on', label: 'From', type: 'date', required: true }, { name: 'ends_on', label: 'To', type: 'date', required: true },
          { name: 'entity_type', label: 'Only for', type: 'select', options: Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label })) }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
      }} />
    </div>
  )
}

export function NotificationSettingsPage() {
  const { userId } = useMe()
  const prefs = useQuery({ queryKey: ['admin', 'prefs', userId], queryFn: () => unwrap<any[]>(db.from('notification_preferences').select('*')) })
  const cats = ['approvals', 'attendance', 'payroll', 'claims', 'learning', 'announcements', 'performance', 'celebrations']
  const save = useAction(({ category, k, on }: { category: string; k: 'in_app' | 'email'; on: boolean }) => {
    const cur = (prefs.data ?? []).find((p) => p.category === category) ?? { in_app: true, email: true }
    return unwrap(db.from('notification_preferences').upsert({ user_id: userId, category, in_app: cur.in_app, email: cur.email, [k]: on }).select('user_id'))
  }, { invalidate: [['admin', 'prefs', userId]] })
  return (
    <div className="space-y-6">
      <PageHeader title="Notification settings" description="Templates control the wording of every notification. Emails are queued and sent by the process-email-outbox function." />
      <Card><CardHeader title="My notification preferences" />
        <table className="w-full text-sm"><thead className="bg-raised text-left text-xs text-muted"><tr><th className="px-5 py-2">Category</th><th className="px-5 py-2">In app</th><th className="px-5 py-2">Email</th></tr></thead>
          <tbody className="divide-y divide-line">{cats.map((c) => { const p = (prefs.data ?? []).find((x) => x.category === c) ?? { in_app: true, email: true }; return (
            <tr key={c}><td className="px-5 py-2.5">{titleCase(c)}</td><td className="px-5"><Switch checked={p.in_app} onCheckedChange={(on) => save.mutate({ category: c, k: 'in_app', on })} /></td><td className="px-5"><Switch checked={p.email} onCheckedChange={(on) => save.mutate({ category: c, k: 'email', on })} /></td></tr>) })}</tbody></table>
      </Card>
      <CrudPage cfg={{
        title: 'Notification templates', embedded: true, table: 'notification_templates', permission: 'admin.manage', orderBy: { column: 'code' }, remove: 'delete',
        columns: [{ key: 'code', header: 'Event' }, { key: 'title_template', header: 'Title' }, { key: 'body_template', header: 'Body', cell: (r) => <span className="line-clamp-1 max-w-sm">{r.body_template}</span> },
          { key: 'scope', header: 'Scope', value: (r) => (r.organisation_id ? 'Custom' : 'System default') }, { key: 'send_email', header: 'Email', value: (r) => (r.send_email ? 'Yes' : 'No') }],
        fields: [{ name: 'code', label: 'Event code', type: 'text', required: true, hint: 'Create a custom template with the same code to override the default' }, { name: 'title_template', label: 'Title', type: 'text', required: true },
          { name: 'body_template', label: 'Body (use {{placeholders}})', type: 'textarea', required: true }, { name: 'send_email', label: 'Also send email', type: 'switch', default: true }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
      }} />
    </div>
  )
}

export function EmailSettingsPage() {
  const outbox = useQuery({ queryKey: ['admin', 'outbox'], queryFn: () => unwrap<any[]>(db.from('email_outbox').select('*').order('created_at', { ascending: false }).limit(200)) })
  return (
    <div className="space-y-5">
      <PageHeader title="Email settings" />
      <SettingsForm section="email" />
      <Card className="p-5 text-sm"><p className="font-medium">Provider</p><p className="mt-1 text-muted">Set <code>RESEND_API_KEY</code> (or SMTP settings) as a Supabase edge-function secret and schedule <code>process-email-outbox</code>. Until then, emails stay queued below — nothing is reported as sent.</p></Card>
      <Card><CardHeader title="Email outbox" /><div className="p-3"><DataTable rows={outbox.data} loading={outbox.isLoading} columns={[
        { key: 'created_at', header: 'Queued', cell: (r) => fmtDateTime(r.created_at) }, { key: 'to_email', header: 'To' }, { key: 'subject', header: 'Subject' },
        { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{titleCase(r.status)}</Badge> }, { key: 'last_error', header: 'Error', hideOnMobile: true },
      ]} /></div></Card>
    </div>
  )
}

export function IntegrationsPage() {
  const health = useQuery({ queryKey: ['admin', 'integration-health'], queryFn: async () => {
    const devices = await unwrap<any[]>(db.from('attendance_devices').select('id, name, last_seen_at, api_key_hash, is_active'))
    const outbox = await unwrap<any[]>(db.from('email_outbox').select('status').limit(500))
    return { devices, queued: outbox.filter((o) => o.status === 'queued').length, sent: outbox.filter((o) => o.status === 'sent').length }
  } })
  const h = health.data
  return (
    <div className="space-y-5">
      <PageHeader title="Integration settings" description="Each integration is behind a replaceable interface. Status below reflects real activity — nothing is shown as connected unless it has actually communicated." />
      <StatStrip items={[
        { label: 'Face models', value: 'On-device', hint: 'Human · FaceRes + anti-spoof + liveness, served from /models' },
        { label: 'Biometric devices', value: h ? `${h.devices.filter((d) => d.last_seen_at).length}/${h.devices.length}` : '—', hint: 'Seen at least once / registered', to: '/attendance/devices' },
        { label: 'Emails sent', value: h?.sent ?? '—', hint: `${h?.queued ?? 0} queued`, to: '/admin/email' },
        { label: 'Maps', value: 'OpenStreetMap', hint: 'Change with VITE_MAP_TILE_URL' },
      ]} />
      <SettingsForm section="face" />
      <Card className="p-5 text-sm leading-relaxed">
        <p className="font-medium">Adding another face-recognition provider</p>
        <p className="mt-1 text-muted">Implement the <code>FaceProvider</code> interface in <code>src/face</code> (detection, embedding, anti-spoof, liveness), register it in <code>src/face/index.ts</code>, and add its similarity formula for the new model id in the <code>face_similarity()</code> database function. Re-enrol employees after switching models — templates are model-specific.</p>
      </Card>
    </div>
  )
}

export function SecurityPage() {
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => unwrap<any[]>(db.from('user_sessions').select('*, user_profiles(full_name, email)').order('created_at', { ascending: false }).limit(300)) })
  return (
    <div className="space-y-5">
      <PageHeader title="Security settings" />
      <SettingsForm section="security" />
      <Card className="p-5 text-sm leading-relaxed text-muted">
        <p className="font-medium text-text">How data is protected</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Every table has row-level security; sensitive operations run in audited database functions that check permissions.</li>
          <li>Face templates have no client access at all; matching runs in the database. Salary, bank and identity data are restricted to the employee and authorised roles.</li>
          <li>Files are in private storage buckets and opened through five-minute signed links.</li>
          <li>The service-role key is used only inside edge functions, never in the browser.</li>
          <li>Retention: biometric templates, recognition logs and location history are purged on schedule (see Face recognition and GPS settings).</li>
        </ul>
      </Card>
      <Card><CardHeader title="Sign-in activity" /><div className="p-3"><DataTable rows={sessions.data} loading={sessions.isLoading} exportName="Sign-in activity" columns={[
        { key: 'created_at', header: 'When', cell: (r) => fmtDateTime(r.created_at) }, { key: 'user', header: 'User', value: (r) => r.user_profiles?.full_name ?? r.user_profiles?.email },
        { key: 'event', header: 'Event', value: (r) => titleCase(r.event) }, { key: 'user_agent', header: 'Device', cell: (r) => <span className="line-clamp-1 max-w-xs text-xs text-muted">{r.user_agent}</span>, hideOnMobile: true },
      ]} /></div></Card>
    </div>
  )
}

export function AuditLogsPage() {
  const [table, setTable] = useState('')
  const q = useQuery({ queryKey: ['admin', 'audit', table], queryFn: () => { let x = db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1000); if (table) x = x.eq('table_name', table); return unwrap<any[]>(x) } })
  const users = useLookup<any>('user_profiles', 'id, full_name', 'full_name')
  const names = new Map((users.data ?? []).map((u) => [u.id, u.full_name]))
  const [open, setOpen] = useState<any | null>(null)
  const tables = [...new Set((q.data ?? []).map((r) => r.table_name).filter(Boolean))].sort()
  return (
    <div>
      <PageHeader title="Audit logs" description="Who changed what and when. Audit rows are written only by the database and cannot be edited or deleted from the app." />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={setOpen} exportName="Audit logs" columns={[
        { key: 'created_at', header: 'When', cell: (r) => fmtDateTime(r.created_at) }, { key: 'actor', header: 'By', value: (r) => names.get(r.actor_id) ?? (r.actor_id ? 'User' : 'System') },
        { key: 'action', header: 'Action', cell: (r) => <Badge tone={r.action === 'DELETE' ? 'danger' : r.action === 'INSERT' ? 'success' : 'primary'}>{r.action}</Badge>, value: (r) => r.action },
        { key: 'table_name', header: 'Record type' }, { key: 'note', header: 'Note', cell: (r) => <span className="line-clamp-1 max-w-sm">{r.note}</span> },
      ]} toolbar={<Select value={table} onChange={(e) => setTable(e.target.value)} className="w-auto" aria-label="Record type"><option value="">All record types</option>{tables.map((t) => <option key={t}>{t}</option>)}</Select>} />
      {open && <Drawer open onOpenChange={(o) => !o && setOpen(null)} title={`${open.action} · ${open.table_name ?? ''}`} description={fmtDateTime(open.created_at)}>
        {open.note && <p className="mb-3 text-sm">{open.note}</p>}
        {(['old_data', 'new_data'] as const).map((k) => open[k] && <div key={k} className="mb-4"><h4 className="mb-1 text-sm font-semibold">{k === 'old_data' ? 'Before' : 'After'}</h4><pre className="max-h-80 overflow-auto rounded-md bg-raised p-3 text-xs">{JSON.stringify(open[k], null, 2)}</pre></div>)}
      </Drawer>}
    </div>
  )
}

const BACKUP_TABLES = ['organisations', 'departments', 'designations', 'locations', 'employees', 'employee_contacts', 'employee_employment_history', 'shifts', 'holidays', 'work_sites',
  'attendance_records', 'leave_types', 'leave_policies', 'leave_balances', 'leave_transactions', 'leave_applications', 'salary_components', 'salary_structures', 'employee_salary_assignments',
  'payroll_runs', 'payroll_entries', 'payroll_entry_lines', 'payslips', 'claim_categories', 'expense_claims', 'reimbursements', 'appraisal_cycles', 'performance_goals', 'appraisal_reviews',
  'announcements', 'courses', 'course_enrolments', 'onboarding_cases', 'offboarding_cases', 'approval_requests', 'approval_tasks']

export function BackupPage() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const run = async (format: 'json' | 'xlsx') => {
    setBusy(true)
    try {
      const out: Record<string, any[]> = {}
      for (const t of BACKUP_TABLES) {
        setProgress(`Exporting ${t}…`)
        const { data, error } = await db.from(t).select('*').limit(50000)
        if (error) throw new Error(`${t}: ${error.message}`)
        out[t] = data ?? []
      }
      const stamp = new Date().toISOString().slice(0, 10)
      if (format === 'json') download(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), tables: out }, null, 1)], { type: 'application/json' }), `hrms-export-${stamp}.json`)
      else {
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        for (const [t, rows] of Object.entries(out)) {
          const ws = wb.addWorksheet(t.slice(0, 31)); const cols = Object.keys(rows[0] ?? { id: '' })
          ws.columns = cols.map((c) => ({ header: c, key: c, width: 16 })); rows.forEach((r) => ws.addRow(Object.fromEntries(cols.map((c) => [c, typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c]]))))
        }
        download(new Blob([await wb.xlsx.writeBuffer()]), `hrms-export-${stamp}.xlsx`)
      }
      toast.success('Export complete')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false); setProgress('') }
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Data backup" description="Export your organisation’s data. Database-level backups (point-in-time recovery) are configured in Supabase." />
      <Card className="p-5">
        <div className="flex flex-wrap gap-2"><Button loading={busy} onClick={() => run('xlsx')}><Download /> Export to Excel</Button><Button variant="secondary" loading={busy} onClick={() => run('json')}><Database /> Export JSON</Button></div>
        {progress && <p className="mt-3 text-sm text-muted">{progress}</p>}
        <p className="mt-4 text-sm text-muted">The export contains only what your role is allowed to read (row-level security applies). Biometric templates are never exported. Store exports securely — they contain personal data.</p>
      </Card>
      <Card className="p-5 text-sm leading-relaxed text-muted"><p className="font-medium text-text">Full database backup</p><p className="mt-1">Supabase Pro and above include daily backups and point-in-time recovery. For self-managed backups run <code>supabase db dump --data-only &gt; backup.sql</code> with the project’s database URL. See docs/OPERATIONS.md.</p></Card>
    </div>
  )
}
