import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, Send, UserPlus, LogOut, ClipboardCheck, Undo2 } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction } from '@/hooks/data'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader, QueryView, StatStrip, EmptyState } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { CrudPage } from '@/components/crud/CrudPage'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader, Progress } from '@/components/ui/misc'
import { cn, fmtDate, isoDate, titleCase, money } from '@/lib/utils'
import { EmployeeForm } from '@/modules/employees/form'
import { DocumentsList } from '@/modules/employees/pages'
import { ApprovalsInbox, MyRequestStatus } from '@/modules/approvals/Inbox'

const FOCUS: Record<string, { title: string; categories: string[] }> = {
  information: { title: 'Employee information', categories: ['information'] },
  documents: { title: 'Document collection', categories: ['documents', 'verification'] },
  checklist: { title: 'Joining checklist', categories: [] },
  assignment: { title: 'Department assignment', categories: ['assignment'] },
  handover: { title: 'Knowledge handover', categories: ['handover'] },
  clearance: { title: 'Department clearance', categories: ['clearance'] },
  interview: { title: 'Exit interview', categories: ['interview'] },
}

const ROLE_LABEL: Record<string, string> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', manager: 'Manager', employee: 'Employee' }

function TaskList({ kind, caseId, focus }: { kind: 'onboarding' | 'offboarding'; caseId: string; focus?: string }) {
  const table = kind === 'onboarding' ? 'onboarding_tasks' : 'offboarding_tasks'
  const q = useQuery({ queryKey: [kind, 'tasks', caseId], queryFn: () => unwrap<any[]>(db.from(table).select('*').eq('case_id', caseId).order('sort_order')) })
  const set = useAction(({ id, status }: { id: string; status: string }) => rpc('complete_lifecycle_task', { p_kind: kind, p_task: id, p_status: status }), { invalidate: [[kind]] })
  const cats = focus ? FOCUS[focus]?.categories ?? [] : []
  const rows = (q.data ?? []).filter((t) => !cats.length || cats.includes(t.category))
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
          <button onClick={() => set.mutate({ id: t.id, status: t.status === 'pending' ? 'done' : 'pending' })} aria-label={t.status === 'pending' ? 'Mark done' : 'Mark pending'} className="shrink-0">
            {t.status === 'done' ? <CheckCircle2 className="h-5 w-5 text-success" /> : t.status === 'skipped' ? <CheckCircle2 className="h-5 w-5 text-subtle" /> : <Circle className="h-5 w-5 text-line" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className={cn('text-sm', t.status !== 'pending' && 'text-muted line-through')}>{t.title}{!t.is_mandatory && <span className="ml-1 text-xs text-subtle">(optional)</span>}</div>
            <div className="text-xs text-subtle">{ROLE_LABEL[t.owner_role] ?? titleCase(t.owner_role)} · {titleCase(t.category)}{t.due_date && ` · due ${fmtDate(t.due_date, 'dd MMM')}`}</div>
          </div>
          {t.status === 'pending' && !t.is_mandatory && <Button size="sm" variant="ghost" onClick={() => set.mutate({ id: t.id, status: 'skipped' })}>Skip</Button>}
          {t.status === 'pending' && t.due_date && t.due_date < isoDate() && <Badge tone="danger">Overdue</Badge>}
        </li>
      ))}
      {rows.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">No tasks in this section</li>}
    </ul>
  )
}

const useCases = (kind: 'onboarding' | 'offboarding') => useQuery({ queryKey: [kind, 'cases'], queryFn: () => unwrap<any[]>(db.from('v_lifecycle_register').select('*').eq('kind', kind).order('created_at', { ascending: false })) })

export function OnboardingPage() {
  const [params] = useSearchParams()
  const focus = params.get('focus') ?? undefined
  const cases = useCases('onboarding')
  const [open, setOpen] = useState<any | null>(null)
  const rows = cases.data ?? []
  return (
    <div className="space-y-5">
      <PageHeader title={focus ? FOCUS[focus]?.title ?? 'Onboarding' : 'Onboarding progress'} description="Each new joiner gets a checklist from your onboarding template. HR signs off completion through the approval workflow."
        actions={<Link to="/onboarding/new"><Button><UserPlus /> Register new employee</Button></Link>} />
      <StatStrip items={[{ label: 'In progress', value: rows.filter((r) => r.status === 'in_progress').length, tone: 'primary' }, { label: 'Awaiting sign-off', to: '/offboarding/approvals', value: rows.filter((r) => r.status === 'pending_approval').length, tone: 'warning' },
        { label: 'Completed', value: rows.filter((r) => r.status === 'completed').length, tone: 'success' }, { label: 'Joining in next 14 days', value: rows.filter((r) => r.key_date >= isoDate() && r.key_date <= isoDate(new Date(Date.now() + 14 * 864e5))).length }]} />
      <DataTable rows={rows} loading={cases.isLoading} error={cases.error} onRowClick={setOpen} exportName="Onboarding" columns={[
        { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} code={r.employee_code} /> }, { key: 'key_date', header: 'Joining', cell: (r) => fmtDate(r.key_date) },
        { key: 'progress', header: 'Progress', value: (r) => r.done_tasks / Math.max(1, r.total_tasks), cell: (r) => <div className="flex w-40 items-center gap-2"><Progress value={(r.done_tasks / Math.max(1, r.total_tasks)) * 100} tone={r.done_tasks === r.total_tasks ? 'success' : 'primary'} /><span className="text-xs tnum">{r.done_tasks}/{r.total_tasks}</span></div> },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} emptyTitle="No onboarding in progress" emptyAction={<Link to="/onboarding/new"><Button><UserPlus /> Register new employee</Button></Link>} />
      {open && <OnboardingCase c={open} focus={focus} onClose={() => setOpen(null)} />}
    </div>
  )
}

function OnboardingCase({ c, focus, onClose }: { c: any; focus?: string; onClose: () => void }) {
  const submit = useAction(() => rpc('submit_onboarding_completion', { p_case: c.id }), { success: 'Sent for HR sign-off', invalidate: [['onboarding']], onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Onboarding · ${c.employee_name}`} description={`Joining ${fmtDate(c.key_date)}`} size="lg"
      footer={<><Link to={`/employees/${c.employee_id}`}><Button variant="secondary">Open profile</Button></Link>{c.status === 'in_progress' && <Button loading={submit.isPending} onClick={() => submit.mutate()}><Send /> Submit for sign-off</Button>}</>}>
      <Card><TaskList kind="onboarding" caseId={c.id} focus={focus === 'checklist' ? undefined : focus} /></Card>
      {(!focus || focus === 'documents') && <div className="mt-5"><h4 className="mb-2 text-sm font-semibold">Documents</h4><DocumentsList employeeId={c.employee_id} /></div>}
      {c.status !== 'in_progress' && <div className="mt-4"><MyRequestStatus entityType="onboarding" entityId={c.id} /></div>}
    </Dialog>
  )
}

export function NewEmployeeRegistration() {
  const nav = useNavigate()
  const [open, setOpen] = useState(true)
  const [buddy, setBuddy] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const start = useAction(() => rpc('start_onboarding', { p_employee: created, p_buddy: buddy }), { success: 'Onboarding checklist created', invalidate: [['onboarding']], onSuccess: () => nav('/onboarding') })
  return (
    <div className="space-y-5">
      <PageHeader title="New employee registration" description="Step 1: create the employee record (ID generated automatically). Step 2: start onboarding to generate their checklist from your template." />
      {!created ? (
        <Card className="p-6"><p className="text-sm text-muted">Fill in the employee details to begin.</p><Button className="mt-3" onClick={() => setOpen(true)}><UserPlus /> Enter employee details</Button></Card>
      ) : (
        <Card className="max-w-xl p-6">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-success" /> Employee created</p>
          <Field label="Onboarding buddy (optional)" className="mt-4"><EmployeePicker value={buddy} onChange={setBuddy} allowClear filter={(e: any) => e.id !== created} /></Field>
          <Button className="mt-4" loading={start.isPending} onClick={() => start.mutate()}><ClipboardCheck /> Start onboarding</Button>
        </Card>
      )}
      <EmployeeForm open={open && !created} onOpenChange={setOpen} onSaved={(id) => setCreated(id)} />
    </div>
  )
}

export const AssetsPage = ({ returnMode }: { returnMode?: boolean }) => {
  const confirm = useConfirm()
  const ret = useAction(({ id, condition }: { id: string; condition?: string }) => unwrap(db.from('employee_assets').update({ status: 'returned', returned_on: isoDate(), condition_on_return: condition ?? null }).eq('id', id).select('id')), { success: 'Asset marked returned', invalidate: [['crud', 'employee_assets']] })
  return <CrudPage cfg={{
    title: returnMode ? 'Asset return' : 'Asset allocation', description: returnMode ? 'Assets issued to employees serving notice. Exit cannot complete while any asset is still issued.' : 'Laptops, tools, ID cards and other company assets.',
    table: 'employee_assets', select: '*, employees(first_name, last_name, employee_code, status)', permission: ['onboarding.manage', 'offboarding.manage', 'employees.manage'], orderBy: { column: 'asset_tag' }, remove: 'delete',
    filter: returnMode ? (q) => q.eq('status', 'issued') : undefined, queryKey: ['crud', 'employee_assets', returnMode ? 'return' : 'all'],
    columns: [{ key: 'asset_tag', header: 'Tag', className: 'tnum' }, { key: 'asset_type', header: 'Type' }, { key: 'description', header: 'Description', hideOnMobile: true },
      { key: 'emp', header: 'Issued to', value: (r) => (r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : '—'), cell: (r) => r.employees ? <span>{r.employees.first_name} {r.employees.last_name}{r.employees.status === 'notice' && <Badge tone="warning" className="ml-1">Notice</Badge>}</span> : '—' },
      { key: 'issued_on', header: 'Issued', cell: (r) => fmtDate(r.issued_on) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
    rowActions: (r) => r.status === 'issued' && <Button size="sm" variant="secondary" onClick={async () => { const c = await confirm({ title: `Mark ${r.asset_tag} returned?`, requireReason: true, reasonLabel: 'Condition on return' }); if (c.ok) ret.mutate({ id: r.id, condition: c.reason }) }}><Undo2 /> Return</Button>,
    fields: [{ name: 'asset_tag', label: 'Asset tag', type: 'text', required: true }, { name: 'asset_type', label: 'Type', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'text' },
      { name: 'serial_number', label: 'Serial number', type: 'text' }, { name: 'employee_id', label: 'Issued to', type: 'employee' }, { name: 'issued_on', label: 'Issued on', type: 'date' },
      { name: 'expected_return', label: 'Expected return', type: 'date' }, { name: 'status', label: 'Status', type: 'select', required: true, default: 'issued', options: ['available', 'issued', 'returned', 'lost', 'damaged'].map((v) => ({ value: v, label: titleCase(v) })) }],
  }} />
}

export function PolicyAcknowledgementPage() {
  const pol = useQuery({ queryKey: ['onboarding', 'policies'], queryFn: () => unwrap<any[]>(db.from('announcements').select('id, title, policy_version, publish_at, announcement_recipients(employee_id, acknowledged_at)').eq('requires_acknowledgement', true).eq('status', 'published')) })
  const dir = useQuery({ queryKey: ['onboarding', 'emp-count'], queryFn: () => unwrap<any[]>(db.from('employee_directory').select('id, full_name, employee_code').neq('status', 'exited')) })
  const [open, setOpen] = useState<any | null>(null)
  return (
    <div>
      <PageHeader title="Policy acknowledgement" description="Policies that require acknowledgement, and who has not yet acknowledged them." actions={<Link to="/engagement/policies"><Button variant="secondary">Publish a policy</Button></Link>} />
      <DataTable rows={pol.data} loading={pol.isLoading} onRowClick={setOpen} columns={[
        { key: 'title', header: 'Policy' }, { key: 'policy_version', header: 'Version' }, { key: 'publish_at', header: 'Published', cell: (r) => fmtDate(r.publish_at) },
        { key: 'ack', header: 'Acknowledged', value: (r) => r.announcement_recipients?.filter((x: any) => x.acknowledged_at).length ?? 0, cell: (r) => { const n = r.announcement_recipients?.filter((x: any) => x.acknowledged_at).length ?? 0; const t = dir.data?.length ?? 0; return <div className="flex w-40 items-center gap-2"><Progress value={(n / Math.max(1, t)) * 100} /><span className="text-xs tnum">{n}/{t}</span></div> } },
      ]} emptyTitle="No policies require acknowledgement" />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={`Pending · ${open?.title ?? ''}`}>
        {open && <ul className="divide-y divide-line">{(dir.data ?? []).filter((e) => !open.announcement_recipients?.some((x: any) => x.employee_id === e.id && x.acknowledged_at)).map((e) => <li key={e.id} className="py-2 text-sm">{e.full_name} <span className="text-xs text-muted">{e.employee_code}</span></li>)}</ul>}
      </Dialog>
    </div>
  )
}

// ---------------- offboarding ----------------
export function OffboardingPage() {
  const { can } = useAuth()
  const { employeeId } = useMe()
  const [params] = useSearchParams()
  const focus = params.get('focus') ?? undefined
  const cases = useCases('offboarding')
  const [open, setOpen] = useState<any | null>(null)
  const [resign, setResign] = useState(false)
  const rows = cases.data ?? []
  const manage = can(['offboarding.manage', 'offboarding.view'])
  return (
    <div className="space-y-5">
      <PageHeader title={focus ? FOCUS[focus]?.title ?? 'Offboarding' : 'Resignation requests'} description="Resignations go through approval. On approval, the exit checklist and department clearances are created automatically."
        actions={<Button variant={manage ? 'secondary' : 'primary'} onClick={() => setResign(true)}><LogOut /> {manage ? 'Record separation' : 'Submit resignation'}</Button>} />
      {manage && <StatStrip items={[{ label: 'Pending approval', value: rows.filter((r) => r.status === 'pending_approval').length, tone: 'warning' }, { label: 'In clearance', value: rows.filter((r) => r.status === 'in_clearance').length, tone: 'primary' },
        { label: 'Leaving in 30 days', value: rows.filter((r) => ['in_clearance', 'approved'].includes(r.status) && r.key_date <= isoDate(new Date(Date.now() + 30 * 864e5))).length }, { label: 'Completed exits', value: rows.filter((r) => r.status === 'completed').length }]} />}
      <DataTable rows={rows.filter((r) => focus ? r.status === 'in_clearance' : true)} loading={cases.isLoading} error={cases.error} onRowClick={setOpen} exportName="Offboarding" columns={[
        { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} code={r.employee_code} /> }, { key: 'reason', header: 'Separation', cell: (r) => <span className="line-clamp-1 max-w-xs">{r.reason}</span> },
        { key: 'key_date', header: 'Last working day', cell: (r) => fmtDate(r.key_date) },
        { key: 'progress', header: 'Exit tasks', value: (r) => r.done_tasks / Math.max(1, r.total_tasks), cell: (r) => r.total_tasks ? <div className="flex w-36 items-center gap-2"><Progress value={(r.done_tasks / r.total_tasks) * 100} /><span className="text-xs tnum">{r.done_tasks}/{r.total_tasks}</span></div> : '—' },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} emptyTitle="No resignations" />
      {open && <OffboardingCase c={open} focus={focus} onClose={() => setOpen(null)} />}
      {resign && <ResignDialog forOthers={can('offboarding.manage')} selfId={employeeId} onClose={() => setResign(false)} />}
    </div>
  )
}

export function ResignDialog({ forOthers, selfId, onClose }: { forOthers?: boolean; selfId: string; onClose: () => void }) {
  // HR recording someone else's exit must pick the employee; never default to the HR user themself
  const [emp, setEmp] = useState<string | null>(forOthers ? null : selfId)
  const [type, setType] = useState('resignation'); const [lwd, setLwd] = useState(isoDate(new Date(Date.now() + 30 * 864e5))); const [reason, setReason] = useState('')
  const submit = useAction(() => rpc('submit_resignation', { p_reason: reason, p_requested_lwd: lwd, p_type: type, p_employee: emp }), { success: 'Submitted for approval', invalidate: [['offboarding']], onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={forOthers ? 'Record separation' : 'Submit resignation'} description={forOthers ? 'Choose the employee who is leaving. The approver can adjust the last working day.' : 'Your notice period is shown on your profile. HR may adjust the last working day on approval.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={submit.isPending} disabled={!reason.trim() || !emp} onClick={() => submit.mutate()}>Submit</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {forOthers && <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>}
        {forOthers && <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{['resignation', 'termination', 'retirement', 'contract_end', 'absconding'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>}
        <Field label="Requested last working day" required><Input type="date" value={lwd} min={isoDate()} onChange={(e) => setLwd(e.target.value)} /></Field>
        <Field label="Reason" required className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

const DEPT_LABEL: Record<string, string> = { hr: 'HR', it: 'IT', admin: 'Admin', finance: 'Finance', stores: 'Stores', reporting_manager: 'Reporting manager' }

function OffboardingCase({ c, focus, onClose }: { c: any; focus?: string; onClose: () => void }) {
  const { can } = useAuth()
  const clr = useQuery({ queryKey: ['offboarding', 'clearance', c.id], queryFn: () => unwrap<any[]>(db.from('clearance_records').select('*').eq('case_id', c.id).order('department')) })
  const assets = useQuery({ queryKey: ['offboarding', 'assets', c.employee_id], queryFn: () => unwrap<any[]>(db.from('employee_assets').select('*').eq('employee_id', c.employee_id).eq('status', 'issued')) })
  const interview = useQuery({ queryKey: ['offboarding', 'interview', c.id], queryFn: () => unwrap<any>(db.from('exit_interviews').select('*').eq('case_id', c.id).maybeSingle()) })
  const update = useAction(({ id, status, dues, remarks }: any) => rpc('update_clearance', { p_id: id, p_status: status, p_dues: dues ?? 0, p_remarks: remarks ?? null }), { success: 'Clearance updated', invalidate: [['offboarding']] })
  const complete = useAction(() => rpc('complete_offboarding', { p_case: c.id }), { success: 'Exit completed and access revoked', invalidate: [['offboarding'], ['directory']], onSuccess: onClose })
  const confirm = useConfirm()
  const [dues, setDues] = useState<{ id: string; dept: string; amount: string; note: string } | null>(null)
  const [iv, setIv] = useState<any>({ primary_reason: '', would_rejoin: false, would_recommend: false, rating_role: 3, rating_manager: 3, rating_culture: 3, rating_growth: 3, liked_most: '', improve: '' })
  const saveIv = useAction(() => unwrap(db.from('exit_interviews').upsert({ ...iv, case_id: c.id }, { onConflict: 'case_id' }).select('id')), { success: 'Exit interview saved', invalidate: [['offboarding', 'interview', c.id]] })
  const show = (s: string) => !focus || focus === s || (focus === 'checklist' && s === 'tasks') || (focus === 'handover' && s === 'tasks')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Exit · ${c.employee_name}`} description={`${c.reason} · last day ${fmtDate(c.key_date)}`} size="xl"
      footer={c.status === 'in_clearance' && can('offboarding.manage') && <Button variant="danger" loading={complete.isPending} onClick={async () => { if ((await confirm({ title: 'Complete exit?', description: 'The employee is marked exited and their login is deactivated. History is kept.', danger: true })).ok) complete.mutate() }}><LogOut /> Complete exit</Button>}>
      {c.status === 'pending_approval' && <MyRequestStatus entityType="resignation" entityId={c.id} />}
      {dues && (
        <Dialog open onOpenChange={(o) => !o && setDues(null)} title={`Record dues · ${dues.dept}`} size="sm"
          footer={<><Button variant="secondary" onClick={() => setDues(null)}>Cancel</Button>
            <Button disabled={!(Number(dues.amount) > 0) || !dues.note.trim()} loading={update.isPending}
              onClick={() => update.mutate({ id: dues.id, status: 'dues_pending', dues: Number(dues.amount), remarks: dues.note.trim() }, { onSuccess: () => setDues(null) })}>Save dues</Button></>}>
          <div className="space-y-4">
            <Field label="Amount (₹)" required><Input type="number" min="0" step="0.01" value={dues.amount} onChange={(e) => setDues({ ...dues, amount: e.target.value })} autoFocus /></Field>
            <Field label="What is owed" required><Textarea value={dues.note} onChange={(e) => setDues({ ...dues, note: e.target.value })} placeholder="e.g. Laptop charger not returned" /></Field>
          </div>
        </Dialog>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {show('tasks') && c.status !== 'pending_approval' && <Card><CardHeader title="Exit checklist" /><TaskList kind="offboarding" caseId={c.id} focus={focus === 'handover' ? 'handover' : undefined} /></Card>}
        {show('clearance') && c.status !== 'pending_approval' && (
          <Card><CardHeader title="Department clearance" />
            <ul className="divide-y divide-line">{(clr.data ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <span>{DEPT_LABEL[r.department] ?? titleCase(r.department)}{Number(r.dues_amount) > 0 && <span className="ml-1 text-xs text-danger">dues {money(r.dues_amount)}</span>}</span>
                <span className="flex items-center gap-2"><StatusBadge status={r.status} />{r.status !== 'cleared' && <Button size="sm" variant="secondary" onClick={() => update.mutate({ id: r.id, status: 'cleared', dues: r.dues_amount, remarks: r.remarks })}>Clear</Button>}
                  {r.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => setDues({ id: r.id, dept: DEPT_LABEL[r.department] ?? titleCase(r.department), amount: '', note: '' })}>Dues</Button>}</span>
              </li>
            ))}</ul>
            <div className="border-t border-line px-5 py-3 text-sm"><span className="font-medium">Assets still issued:</span> {(assets.data ?? []).length === 0 ? <span className="text-success">none</span> : (assets.data ?? []).map((a) => a.asset_tag).join(', ')} <Link to="/offboarding/assets" className="ml-1 text-primary hover:underline">Manage</Link></div>
          </Card>
        )}
        {show('interview') && c.status !== 'pending_approval' && can('offboarding.manage') && (
          <Card className="lg:col-span-2"><CardHeader title="Exit interview" description={interview.data ? `Recorded ${fmtDate(interview.data.conducted_at)}` : undefined} actions={!interview.data && <Button size="sm" loading={saveIv.isPending} onClick={() => saveIv.mutate()}>Save</Button>} />
            {interview.data ? (
              <dl className="grid gap-3 p-5 text-sm sm:grid-cols-4">{['rating_role', 'rating_manager', 'rating_culture', 'rating_growth'].map((k) => <div key={k}><dt className="text-muted">{titleCase(k.replace('rating_', ''))}</dt><dd className="figure text-xl">{interview.data[k]}/5</dd></div>)}
                <div className="sm:col-span-2"><dt className="text-muted">Primary reason</dt><dd>{interview.data.primary_reason}</dd></div><div><dt className="text-muted">Would rejoin</dt><dd>{interview.data.would_rejoin ? 'Yes' : 'No'}</dd></div><div><dt className="text-muted">Would recommend</dt><dd>{interview.data.would_recommend ? 'Yes' : 'No'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted">Liked most</dt><dd>{interview.data.liked_most}</dd></div><div className="sm:col-span-2"><dt className="text-muted">Could improve</dt><dd>{interview.data.improve}</dd></div></dl>
            ) : (
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <Field label="Primary reason for leaving" className="sm:col-span-2"><Select value={iv.primary_reason} onChange={(e) => setIv({ ...iv, primary_reason: e.target.value })}><option value="">Select…</option>{['Career growth', 'Compensation', 'Relocation', 'Higher studies', 'Work-life balance', 'Manager', 'Health / personal', 'Other'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
                {['rating_role', 'rating_manager', 'rating_culture', 'rating_growth'].map((k) => <Field key={k} label={`${titleCase(k.replace('rating_', ''))} (1–5)`}><Input type="number" min={1} max={5} value={iv[k]} onChange={(e) => setIv({ ...iv, [k]: Number(e.target.value) })} /></Field>)}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={iv.would_rejoin} onChange={(e) => setIv({ ...iv, would_rejoin: e.target.checked })} />Would rejoin</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={iv.would_recommend} onChange={(e) => setIv({ ...iv, would_recommend: e.target.checked })} />Would recommend</label>
                <Field label="What did they like most?" className="sm:col-span-2"><Textarea value={iv.liked_most} onChange={(e) => setIv({ ...iv, liked_most: e.target.value })} /></Field>
                <Field label="What could we improve?" className="sm:col-span-2"><Textarea value={iv.improve} onChange={(e) => setIv({ ...iv, improve: e.target.value })} /></Field>
              </div>
            )}
          </Card>
        )}
      </div>
    </Dialog>
  )
}

export const ResignationApprovalsPage = () => <ApprovalsInbox entityTypes={['resignation', 'onboarding']} title="Resignation & onboarding approvals" description="Resignations and onboarding sign-offs waiting for your decision." />

export function ExitHistoryPage() {
  const q = useQuery({ queryKey: ['offboarding', 'history'], queryFn: () => unwrap<any[]>(db.from('offboarding_cases').select('*, employees(first_name, last_name, employee_code, date_of_joining), exit_interviews(primary_reason, would_rejoin)').eq('status', 'completed').order('exit_completed_at', { ascending: false })) })
  return (
    <div>
      <PageHeader title="Employee exit history" description="Completed separations. Records are retained for audit and statutory purposes." />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Exit history" columns={[
        { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> },
        { key: 'separation_type', header: 'Type', value: (r) => titleCase(r.separation_type) }, { key: 'joined', header: 'Joined', cell: (r) => fmtDate(r.employees?.date_of_joining) },
        { key: 'lwd', header: 'Last day', cell: (r) => fmtDate(r.approved_lwd ?? r.requested_lwd) }, { key: 'reason', header: 'Reason', cell: (r) => <span className="line-clamp-1 max-w-xs">{r.reason}</span> },
        { key: 'exit', header: 'Exit interview', value: (r) => r.exit_interviews?.[0]?.primary_reason ?? r.exit_interviews?.primary_reason ?? '—' },
      ]} emptyTitle="No completed exits" />
    </div>
  )
}
