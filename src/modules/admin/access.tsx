import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, KeyRound, RefreshCw, Save, ShieldAlert, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader, QueryView } from '@/components/common/page'
import { EmployeePicker } from '@/components/common/pickers'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader, Switch, Tabs, TabsContent, TabsList, TabsTrigger, type Tone } from '@/components/ui/misc'
import { cn, ago, fmtDateTime } from '@/lib/utils'
import { UsersListPage } from './pages'

type Req = {
  id: string; user_id: string; email: string; full_name: string; mobile: string | null; requested_role: string
  job_title: string | null; message: string | null; status: 'pending' | 'approved' | 'rejected'; decision_note: string | null
  granted_roles: string[] | null; created_at: string; decided_at: string | null
}
const statusTone: Record<Req['status'], Tone> = { pending: 'warning', approved: 'success', rejected: 'danger' }
const TABS = ['people', 'requests', 'signup'] as const

export function UsersPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab')! : 'people'
  const pending = useQuery({ queryKey: ['admin', 'access-requests', 'count'], refetchInterval: 60_000,
    queryFn: async () => (await db.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')).count ?? 0 })
  return (
    <div>
      <PageHeader title="User management" description="Accounts, access requests from new sign-ups, and who may sign up." />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'people' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="requests">Access requests{!!pending.data && <Badge tone="warning" className="ml-1.5">{pending.data}</Badge>}</TabsTrigger>
          <TabsTrigger value="signup">Sign-up settings</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="mt-4"><UsersListPage /></TabsContent>
        <TabsContent value="requests" className="mt-4"><AccessRequests /></TabsContent>
        <TabsContent value="signup" className="mt-4"><SignupSettings onOpenRequests={() => setParams({ tab: 'requests' })} /></TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- requests
function AccessRequests() {
  const [show, setShow] = useState<'pending' | 'all'>('pending')
  const confirm = useConfirm()
  const roles = useLookup<{ id: string; code: string; name: string }>('roles', 'id, code, name', 'name')
  const roleName = (c: string) => roles.data?.find((r) => r.code === c)?.name ?? c
  const reqs = useQuery({
    queryKey: ['admin', 'access-requests', show],
    queryFn: () => unwrap<Req[]>((show === 'pending' ? db.from('access_requests').select('*').eq('status', 'pending') : db.from('access_requests').select('*')).order('created_at', { ascending: false }).limit(500)),
  })
  const [approve, setApprove] = useState<Req | null>(null)
  const reject = useAction(({ id, note }: { id: string; note: string }) => rpc('decide_access_request', { p_request: id, p_approve: false, p_note: note }),
    { success: 'Request rejected — the person has been emailed the reason', invalidate: [['admin', 'access-requests']] })
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">People who signed up with your company code. They can’t see anything until you approve them.</p>
        <div className="flex rounded-md border border-line p-0.5 text-sm">{(['pending', 'all'] as const).map((v) => (
          <button key={v} onClick={() => setShow(v)} className={cn('rounded px-3 py-1', show === v ? 'bg-raised font-medium' : 'text-muted')}>{v === 'pending' ? 'Pending' : 'All'}</button>
        ))}</div>
      </div>
      <DataTable rows={reqs.data} loading={reqs.isLoading} error={reqs.error} exportName="Access requests"
        emptyTitle={show === 'pending' ? 'No pending requests' : 'No requests yet'} emptyDescription="Share your company code from the Sign-up settings tab with new staff." 
        columns={[
          { key: 'full_name', header: 'Person', value: (r) => `${r.full_name} ${r.email}`, cell: (r) => <div><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted">{r.email}{r.mobile ? ` · ${r.mobile}` : ''}</div></div> },
          { key: 'requested_role', header: 'Asked for', value: (r) => roleName(r.requested_role), cell: (r) => (
            <div><Badge tone={r.requested_role === 'super_admin' || r.requested_role === 'hr_admin' ? 'danger' : 'primary'}>{roleName(r.requested_role)}</Badge>
              {r.granted_roles && <div className="mt-1 text-xs text-muted">Granted: {r.granted_roles.map(roleName).join(', ')}</div>}</div>) },
          { key: 'job_title', header: 'Details', value: (r) => [r.job_title, r.message].filter(Boolean).join(' — '), cell: (r) => (
            <div className="max-w-xs text-sm">{r.job_title && <div>{r.job_title}</div>}{r.message && <div className="line-clamp-2 text-xs text-muted">{r.message}</div>}{!r.job_title && !r.message && <span className="text-subtle">—</span>}</div>) },
          { key: 'created_at', header: 'Requested', value: (r) => r.created_at, cell: (r) => <span title={fmtDateTime(r.created_at)}>{ago(r.created_at)}</span> },
          { key: 'status', header: 'Status', cell: (r) => <div><Badge tone={statusTone[r.status]}>{r.status}</Badge>{r.status === 'rejected' && r.decision_note && <div className="mt-1 max-w-[200px] truncate text-xs text-muted" title={r.decision_note}>{r.decision_note}</div>}</div> },
          { key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => r.status !== 'pending' ? null : (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="success" onClick={() => setApprove(r)}><UserCheck /> Approve</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                const c = await confirm({ title: `Reject ${r.full_name}?`, description: 'They will be emailed the reason and can send a corrected request.', requireReason: true, reasonLabel: 'Reason (sent to the person)', danger: true, confirmLabel: 'Reject' })
                if (c.ok && c.reason) reject.mutate({ id: r.id, note: c.reason })
              }}><UserX /> Reject</Button>
            </div>) },
        ]} />
      {approve && <ApproveDialog req={approve} roles={roles.data ?? []} onClose={() => setApprove(null)} />}
    </div>
  )
}

function ApproveDialog({ req, roles, onClose }: { req: Req; roles: { id: string; code: string; name: string }[]; onClose: () => void }) {
  const { access } = useAuth()
  const isSuper = !!access?.roles.includes('super_admin')
  const initial = useMemo(() => {
    const s = new Set([req.requested_role])
    if (!['kiosk', 'super_admin'].includes(req.requested_role)) s.add('employee')
    if (req.requested_role === 'super_admin' && !isSuper) { s.delete('super_admin'); s.add('employee') }
    return [...s]
  }, [req, isSuper])
  const [sel, setSel] = useState<string[]>(initial)
  const [link, setLink] = useState<'create' | 'existing' | 'none'>(req.requested_role === 'kiosk' ? 'none' : 'create')
  const [emp, setEmp] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const dangerous = sel.some((c) => ['super_admin', 'hr_admin', 'finance_admin'].includes(c))
  const go = useAction(() => rpc('decide_access_request', {
    p_request: req.id, p_approve: true, p_roles: sel, p_employee_id: link === 'existing' ? emp : null, p_create_employee: link === 'create', p_note: note || null,
  }), { success: `${req.full_name} can now sign in`, invalidate: [['admin', 'access-requests'], ['admin', 'users'], ['directory']], onSuccess: onClose })
  const opt = (v: typeof link, title: string, sub: string) => (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm', link === v ? 'border-primary bg-primary-soft' : 'border-line')}>
      <input type="radio" className="mt-1" checked={link === v} onChange={() => setLink(v)} />
      <span><span className="font-medium">{title}</span><span className="block text-xs text-muted">{sub}</span></span>
    </label>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={`Approve ${req.full_name}`} description={`${req.email} asked to join as ${roles.find((r) => r.code === req.requested_role)?.name ?? req.requested_role}.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" loading={go.isPending} disabled={!sel.length || (link === 'existing' && !emp)} onClick={() => go.mutate()}><Check /> Approve access</Button></>}>
      <div className="space-y-5">
        <Field label="Roles to grant" hint="You decide — the requested role is only a suggestion.">
          <div className="flex flex-wrap gap-1.5">{roles.map((r) => {
            const locked = r.code === 'super_admin' && !isSuper
            return <button key={r.id} type="button" disabled={locked} title={locked ? 'Only a super administrator can grant this role' : undefined}
              onClick={() => setSel(sel.includes(r.code) ? sel.filter((x) => x !== r.code) : [...sel, r.code])}
              className={cn('rounded-md border px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40', sel.includes(r.code) ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:bg-raised')}>{r.name}</button>
          })}</div>
        </Field>
        {dangerous && <p className="flex items-start gap-2 rounded-md bg-warning-soft p-3 text-sm text-warning"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />These roles can see salaries or change other people’s access. Confirm this person’s identity before approving.</p>}
        <Field label="Employee record">
          <div className="grid gap-2 sm:grid-cols-3">
            {opt('create', 'Create new', 'A new employee with a generated ID')}
            {opt('existing', 'Link existing', 'HR already added this person')}
            {opt('none', 'No record', 'Kiosk or external account')}
          </div>
          {link === 'existing' && <div className="mt-2"><EmployeePicker value={emp} onChange={setEmp} placeholder="Choose the employee" filter={(e: any) => !e.user_id} /></div>}
        </Field>
        {(req.job_title || req.message) && <div className="rounded-md bg-raised p-3 text-sm">{req.job_title && <div><span className="text-muted">Job title: </span>{req.job_title}</div>}{req.message && <div className="mt-1 whitespace-pre-wrap text-muted">{req.message}</div>}</div>}
        <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

// ---------------------------------------------------------------- sign-up settings
type Settings = { organisation_id: string; join_code: string; signup_enabled: boolean; allowed_email_domains: string[]; updated_at: string }

function SignupSettings({ onOpenRequests }: { onOpenRequests: () => void }) {
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['admin', 'signup-settings'], queryFn: () => unwrap<Settings>(db.from('signup_settings').select('*').single()) })
  const org = useQuery({ queryKey: ['organisation-name'], queryFn: async () => (await db.from('organisations').select('name').maybeSingle()).data?.name as string | undefined })
  const [domains, setDomains] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => { if (q.data) setDomains(q.data.allowed_email_domains.join(', ')) }, [q.data])
  const update = useAction((patch: Partial<Settings>) => unwrap(db.from('signup_settings').update(patch).eq('organisation_id', q.data!.organisation_id).select('organisation_id')),
    { success: 'Sign-up settings saved', invalidate: [['admin', 'signup-settings']] })
  const rotate = useAction(() => rpc<string>('rotate_join_code'), { success: 'New company code created — the old one no longer works', invalidate: [['admin', 'signup-settings']] })
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1500) } catch { toast.error('Copy failed — select the text and copy it manually') }
  }
  const signupUrl = `${location.origin}/signup`
  return (
    <QueryView q={q}>
      {(s) => {
        const invite = `Join ${org.data ?? 'our company'} on Apex HRMS: open ${signupUrl}, choose “Join my company” and enter the code ${s.join_code}. An administrator will approve your account.`
        return (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Company code" description="New staff enter this when they sign up. Treat it like a password — rotate it if it leaks." />
              <div className="space-y-4 p-5">
                <div className="flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3">
                  <KeyRound className="h-5 w-5 text-primary" />
                  <code className="flex-1 select-all font-mono text-xl tracking-[0.15em]">{s.join_code}</code>
                  <Button size="sm" variant="secondary" onClick={() => copy(s.join_code, 'code')}>{copied === 'code' ? <Check /> : <Copy />} Copy</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => copy(invite, 'invite')}>{copied === 'invite' ? <Check /> : <Copy />} Copy invitation text</Button>
                  <Button variant="ghost" loading={rotate.isPending} onClick={async () => { if ((await confirm({ title: 'Create a new company code?', description: 'The current code stops working immediately. Pending requests are not affected.', danger: true, confirmLabel: 'Rotate code' })).ok) rotate.mutate() }}><RefreshCw /> Rotate code</Button>
                </div>
                <p className="text-xs text-muted">Sign-up page: <a className="text-primary hover:underline" href={signupUrl} target="_blank" rel="noreferrer">{signupUrl}</a>. A correct code only creates a <b>request</b> — nobody gets access until you approve them in <button className="text-primary hover:underline" onClick={onOpenRequests}>Access requests</button>.</p>
              </div>
            </Card>
            <Card>
              <CardHeader title="Who can request access" />
              <div className="space-y-5 p-5">
                <label className="flex items-center justify-between gap-4 rounded-md border border-line px-3 py-2.5">
                  <span><span className="text-sm font-medium">Accept new sign-ups</span><span className="block text-xs text-muted">Turn off to stop all new requests, even with the right code.</span></span>
                  <Switch checked={s.signup_enabled} disabled={update.isPending} onCheckedChange={(v) => update.mutate({ signup_enabled: v })} />
                </label>
                <Field label="Allowed email domains" hint="Comma-separated, e.g. apex.com, apex.in. Leave empty to allow any email address.">
                  <div className="flex gap-2">
                    <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="Any domain" />
                    <Button variant="secondary" loading={update.isPending} disabled={domains === s.allowed_email_domains.join(', ')}
                      onClick={() => update.mutate({ allowed_email_domains: domains.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean) })}><Save /> Save</Button>
                  </div>
                </Field>
                <ul className="space-y-1.5 text-xs text-muted">
                  <li>• Every sign-up must confirm their email address first.</li>
                  <li>• Five wrong codes lock an account out of requesting for an hour.</li>
                  <li>• Only a super administrator can grant the super administrator role.</li>
                  <li>• Approvals, rejections and code changes are recorded in the audit log.</li>
                </ul>
                <p className="text-xs text-subtle">Last changed {ago(s.updated_at)}</p>
              </div>
            </Card>
          </div>
        )
      }}
    </QueryView>
  )
}
