import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftRight, CheckCircle2, Trash2, FileUp, LayoutGrid, List, Pencil, Plus, UserCheck, UserX, Building2, ExternalLink, Mail, Phone, MapPin } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useDirectory, type DirectoryRow } from '@/hooks/data'
import { uploadFileDetailed, openFile } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, QueryView, StatStrip, EmptyState } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { CrudPage, LookupSelect, type CrudConfig } from '@/components/crud/CrudPage'
import { FileDrop } from '@/components/common/upload'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Avatar, Badge, Card, CardHeader, Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { cn, fmtDate, fmtDateTime, fmtTime, minutes, money, titleCase, ago } from '@/lib/utils'
import { EmployeeForm } from './form'
import { AttendanceCalendarView } from '@/modules/attendance/pages'

// ---------------- directory ----------------
export function Directory({ cards: initialCards = false }: { cards?: boolean }) {
  const { can } = useAuth()
  const nav = useNavigate()
  const dir = useDirectory(true)
  const [cards, setCards] = useState(initialCards)
  const [dept, setDept] = useState('')
  const [status, setStatus] = useState('current')
  const [creating, setCreating] = useState(false)
  const canOpen = can(['employees.view', 'employees.view_team'])
  const rows = (dir.data ?? []).filter((e) => (!dept || (e.department_ids?.length ? e.department_ids.includes(dept) : e.department_id === dept)) && (status === 'all' || (status === 'current' ? e.status !== 'exited' : e.status === status)))
  const depts = [...new Map((dir.data ?? []).flatMap((e) => { const ids = e.department_ids?.length ? e.department_ids : e.department_id ? [e.department_id] : []; const names = (e.department_names ?? e.department_name ?? '').split(', '); return ids.map((id, i) => [id, names[i] ?? e.department_name] as [string, string | null]) })).entries()]
  const cols: Column<DirectoryRow>[] = [
    { key: 'full_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.full_name} photo={r.photo_url} sub={r.official_email ?? r.employee_code} /> },
    { key: 'employee_code', header: 'ID', className: 'tnum' },
    { key: 'designation_name', header: 'Designation' },
    { key: 'department_name', header: 'Department', hideOnMobile: true, value: (r: any) => r.department_names || r.department_name },
    { key: 'location_name', header: 'Location', hideOnMobile: true },
    { key: 'date_of_joining', header: 'Joined', cell: (r) => fmtDate(r.date_of_joining), hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ]
  return (
    <div>
      <PageHeader title={initialCards ? 'Employee profiles' : 'Employee directory'} description="Everyone in the organisation. Personal details are visible only to the employee, their reporting line and HR."
        actions={can('employees.manage') && <Button onClick={() => setCreating(true)}><Plus /> New employee</Button>} />
      {cards ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto"><option value="">All departments</option>{depts.map(([id, n]) => <option key={id!} value={id!}>{n}</option>)}</Select>
            <Button variant="secondary" size="sm" onClick={() => setCards(false)}><List /> Table</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((e) => (
              <button key={e.id} disabled={!canOpen} onClick={() => nav(`/employees/${e.id}`)} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-primary/40 disabled:cursor-default">
                <Avatar name={e.full_name} src={e.photo_url} size={44} />
                <div className="min-w-0"><div className="truncate font-medium">{e.full_name}</div><div className="truncate text-sm text-muted">{e.designation_name}</div><div className="mt-1 flex items-center gap-2 text-xs text-subtle"><span>{e.employee_code}</span><StatusBadge status={e.status} /></div></div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <DataTable rows={rows} columns={cols} loading={dir.isLoading} error={dir.error} exportName="Employee directory" onRowClick={canOpen ? (r) => nav(`/employees/${r.id}`) : undefined}
          toolbar={<>
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto" aria-label="Department"><option value="">All departments</option>{depts.map(([id, n]) => <option key={id!} value={id!}>{n}</option>)}</Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status"><option value="current">Current</option><option value="all">All incl. exited</option>{['onboarding', 'probation', 'active', 'notice', 'exited'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
            <Button variant="ghost" size="sm" onClick={() => setCards(true)}><LayoutGrid /> Cards</Button>
          </>} />
      )}
      <EmployeeForm open={creating} onOpenChange={setCreating} onSaved={(id) => nav(`/employees/${id}`)} />
    </div>
  )
}

// ---------------- profile ----------------
function KV({ items }: { items: [string, React.ReactNode][] }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{items.map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 text-sm">{v || '—'}</dd></div>)}</dl>
}

function useEmp(id: string) {
  return useQuery({ queryKey: ['employee', id], queryFn: () => unwrap<any>(db.from('employees').select('*, departments!employees_department_id_fkey(name), designations(name), locations(name), shifts(name, start_time, end_time), manager:reporting_manager_id(id, first_name, last_name)').eq('id', id).single()) })
}

export function EmployeeProfile() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const { employeeId } = useMe()
  const confirm = useConfirm()
  const q = useEmp(id)
  const dirRow = useDirectory(true).data?.find((x) => x.id === id)
  const deptLabel = dirRow?.department_names || q.data?.departments?.name
  const [editing, setEditing] = useState(false)
  const deactivate = useAction(async (reason: string) => {
    await unwrap(db.from('employees').update({ status: 'inactive' }).eq('id', id).select('id'))
    await unwrap(db.from('employee_employment_history').insert({ employee_id: id, event_type: 'status_change', from_status: q.data?.status, to_status: 'inactive', remarks: reason }).select('id'))
  }, { success: 'Employee deactivated', invalidate: [['employee', id], ['directory']] })
  const confirmEmp = useAction(async () => {
    await unwrap(db.from('employees').update({ status: 'active', confirmation_date: new Date().toISOString().slice(0, 10) }).eq('id', id).select('id'))
    await unwrap(db.from('employee_employment_history').insert({ employee_id: id, event_type: 'confirmed', from_status: q.data?.status, to_status: 'active' }).select('id'))
  }, { success: 'Employment confirmed', invalidate: [['employee', id], ['directory']] })
  const self = id === employeeId
  return (
    <QueryView q={q}>
      {(e) => {
        const name = `${e.first_name} ${e.last_name}`.trim()
        return (
          <div className="space-y-5">
            <PageHeader title={name} crumbs={[{ label: 'Employee Management', to: '/employees' }, { label: 'Profile' }]}
              actions={can('employees.manage') && <>
                {e.status === 'probation' && <Button variant="secondary" onClick={() => confirmEmp.mutate()}><UserCheck /> Confirm employment</Button>}
                {!['exited', 'inactive'].includes(e.status) && <Button variant="secondary" onClick={async () => { const c = await confirm({ title: `Deactivate ${name}?`, description: 'They will lose access. History is kept.', danger: true, requireReason: true, confirmLabel: 'Deactivate' }); if (c.ok) deactivate.mutate(c.reason!) }}><UserX /> Deactivate</Button>}
                <Button onClick={() => setEditing(true)}><Pencil /> Edit</Button>
              </>} />
            <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
              <Avatar name={name} src={e.photo_url} size={72} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{name}</h2><StatusBadge status={e.status} />{e.is_field_employee && <Badge tone="info">Field</Badge>}</div>
                <p className="text-sm text-muted">{e.designations?.name ?? '—'} · {deptLabel ?? '—'}</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                  <span className="tnum">{e.employee_code}</span>
                  {e.official_email && <a href={`mailto:${e.official_email}`} className="flex items-center gap-1 hover:text-text"><Mail className="h-3.5 w-3.5" />{e.official_email}</a>}
                  {e.mobile && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{e.mobile}</span>}
                  {e.locations?.name && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{e.locations.name}</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm sm:text-right">
                <div><div className="text-xs text-muted">Joined</div><div>{fmtDate(e.date_of_joining)}</div></div>
                <div><div className="text-xs text-muted">Reports to</div><div>{e.manager ? <Link className="text-primary hover:underline" to={`/employees/${e.manager.id}`}>{e.manager.first_name} {e.manager.last_name}</Link> : '—'}</div></div>
              </div>
            </Card>
            <Tabs defaultValue="overview">
              <TabsList>
                {['overview', 'personal', 'employment', 'attendance', 'leave', 'payroll', 'claims', 'performance', 'learning', 'documents', 'activity'].map((t) => <TabsTrigger key={t} value={t}>{titleCase(t)}</TabsTrigger>)}
              </TabsList>
              <TabsContent value="overview"><ProfileOverview e={e} /></TabsContent>
              <TabsContent value="personal"><ProfilePersonal e={e} self={self} /></TabsContent>
              <TabsContent value="employment">
                <Card className="p-5"><KV items={[
                  ['Employee ID', e.employee_code], ['Employment type', titleCase(e.employment_type)], ['Status', <StatusBadge status={e.status} />],
                  [(q.data?.department_ids?.length ?? 0) > 1 ? 'Departments' : 'Department', deptLabel], ['Designation', e.designations?.name], ['Location', e.locations?.name],
                  ['Shift', e.shifts ? `${e.shifts.name} (${fmtTime(e.shifts.start_time)}–${fmtTime(e.shifts.end_time)})` : 'Company default'],
                  ['Date of joining', fmtDate(e.date_of_joining)], ['Probation ends', fmtDate(e.probation_end_date)], ['Confirmed on', fmtDate(e.confirmation_date)],
                  ['Notice period', `${e.notice_period_days} days`], ['Exit date', fmtDate(e.exit_date)],
                ]} /></Card>
                <div className="mt-4"><HistoryTable employeeId={e.id} /></div>
              </TabsContent>
              <TabsContent value="attendance"><AttendanceCalendarView employeeId={e.id} /></TabsContent>
              <TabsContent value="leave"><ProfileLeave employeeId={e.id} /></TabsContent>
              <TabsContent value="payroll"><ProfilePayroll employeeId={e.id} /></TabsContent>
              <TabsContent value="claims"><ProfileClaims employeeId={e.id} /></TabsContent>
              <TabsContent value="performance"><ProfilePerformance employeeId={e.id} /></TabsContent>
              <TabsContent value="learning"><ProfileLearning employeeId={e.id} /></TabsContent>
              <TabsContent value="documents"><DocumentsList employeeId={e.id} /></TabsContent>
              <TabsContent value="activity"><ProfileActivity employeeId={e.id} /></TabsContent>
            </Tabs>
            <EmployeeForm open={editing} onOpenChange={setEditing} employee={e} />
          </div>
        )
      }}
    </QueryView>
  )
}

function ProfileOverview({ e }: { e: any }) {
  const att = useQuery({ queryKey: ['attendance', 'emp30', e.id], queryFn: () => unwrap<any[]>(db.from('attendance_records').select('status, is_late, worked_minutes').eq('employee_id', e.id).gte('work_date', new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))) })
  const bal = useQuery({ queryKey: ['leave', 'bal', e.id], queryFn: () => unwrap<any[]>(db.from('v_leave_balances').select('*').eq('employee_id', e.id).eq('leave_year', new Date().getFullYear())) })
  const rs = att.data ?? []
  const working = rs.filter((r) => !['holiday', 'weekly_off'].includes(r.status))
  return (
    <div className="space-y-4">
      <StatStrip items={[
        { label: 'Attendance (30 days)', value: working.length ? `${Math.round((working.filter((r) => ['present', 'half_day', 'incomplete'].includes(r.status)).length / Math.max(1, working.filter((r) => r.status !== 'on_leave').length)) * 100)}%` : '—' },
        { label: 'Late arrivals (30 days)', value: rs.filter((r) => r.is_late).length, tone: 'warning' },
        { label: 'Avg hours / day', value: working.length ? minutes(rs.reduce((a, r) => a + r.worked_minutes, 0) / Math.max(1, rs.filter((r) => r.worked_minutes > 0).length)) : '—' },
        { label: 'Service', value: `${Math.max(0, (Date.now() - new Date(e.date_of_joining).getTime()) / 3.156e10).toFixed(1)} yrs` },
      ]} />
      <Card><CardHeader title="Leave balances" />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {(bal.data ?? []).map((b) => <div key={b.leave_type_id} className="rounded-lg border border-line p-3"><div className="text-xs text-muted">{b.leave_type_name}</div><div className="figure text-2xl">{Number(b.balance)}</div><div className="text-xs text-subtle">{Number(b.used)} used</div></div>)}
          {bal.data?.length === 0 && <p className="text-sm text-muted">No balances this year.</p>}
        </div>
      </Card>
    </div>
  )
}

function ProfilePersonal({ e, self }: { e: any; self: boolean }) {
  const { can } = useAuth()
  const contacts = useQuery({ queryKey: ['employee', e.id, 'contacts'], queryFn: () => unwrap<any[]>(db.from('employee_contacts').select('*').eq('employee_id', e.id)) })
  const bank = useQuery({ queryKey: ['employee', e.id, 'bank'], enabled: self || can('employees.sensitive'), queryFn: () => unwrap<any>(db.from('employee_bank_details').select('*').eq('employee_id', e.id).maybeSingle()) })
  const [editBank, setEditBank] = useState(false)
  return (
    <div className="space-y-4">
      <Card className="p-5"><KV items={[
        ['Date of birth', fmtDate(e.date_of_birth)], ['Gender', titleCase(e.gender)], ['Blood group', e.blood_group], ['Marital status', titleCase(e.marital_status)],
        ['Personal email', e.personal_email], ['Mobile', e.mobile], ['Address', [e.address_line, e.city, e.state, e.postal_code].filter(Boolean).join(', ')],
      ]} /></Card>
      <CrudPage cfg={{
        title: 'Emergency contacts', embedded: true, table: 'employee_contacts', orgScoped: false, permission: self ? 'attendance.clock' : 'employees.manage', queryKey: ['employee', e.id, 'contacts'],
        filter: (q) => q.eq('employee_id', e.id), remove: 'delete', defaults: () => ({ employee_id: e.id }),
        columns: [{ key: 'name', header: 'Name' }, { key: 'relationship', header: 'Relationship' }, { key: 'phone', header: 'Phone' }, { key: 'is_primary', header: 'Primary', value: (r) => (r.is_primary ? 'Yes' : '') }],
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'relationship', label: 'Relationship', type: 'text', required: true },
          { name: 'phone', label: 'Phone', type: 'text', required: true }, { name: 'email', label: 'Email', type: 'email' }, { name: 'is_primary', label: 'Primary contact', type: 'switch' }],
        transform: (v) => ({ ...v, employee_id: e.id }),
      }} />
      {(self || can('employees.sensitive')) && (
        <Card>
          <CardHeader title="Bank & statutory" description="Visible only to the employee and authorised HR/finance." actions={can('employees.sensitive') && <Button size="sm" variant="secondary" onClick={() => setEditBank(true)}><Pencil /> Edit</Button>} />
          <div className="p-5">{bank.data ? <KV items={[
            ['Bank', bank.data.bank_name], ['Account holder', bank.data.account_holder], ['Account number', bank.data.account_number ? `•••• ${String(bank.data.account_number).slice(-4)}` : null],
            ['IFSC', bank.data.ifsc], ['PAN', bank.data.pan], ['UAN', bank.data.uan], ['PF / ESI / PT', `${bank.data.pf_applicable ? 'PF' : '—'} · ${bank.data.esi_applicable ? 'ESI' : '—'} · ${bank.data.pt_applicable ? 'PT' : '—'}`],
          ]} /> : <p className="text-sm text-muted">Not recorded.</p>}</div>
        </Card>
      )}
      {editBank && <BankDialog employeeId={e.id} initial={bank.data} onClose={() => setEditBank(false)} />}
    </div>
  )
}

function BankDialog({ employeeId, initial, onClose }: { employeeId: string; initial: any; onClose: () => void }) {
  const [v, setV] = useState<any>({ bank_name: '', account_holder: '', account_number: '', ifsc: '', pan: '', uan: '', pf_number: '', esi_number: '', pf_applicable: true, esi_applicable: true, pt_applicable: true, ...initial })
  const save = useAction(() => unwrap(db.from('employee_bank_details').upsert({ ...v, employee_id: employeeId }).select('employee_id')), { success: 'Saved', invalidate: [['employee', employeeId, 'bank']], onSuccess: onClose })
  const f = (k: string, label: string) => <Field label={label}><Input value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Bank & statutory details" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {f('bank_name', 'Bank')}{f('account_holder', 'Account holder')}{f('account_number', 'Account number')}{f('ifsc', 'IFSC')}{f('pan', 'PAN')}{f('uan', 'UAN')}{f('pf_number', 'PF number')}{f('esi_number', 'ESI number')}
        {(['pf_applicable', 'esi_applicable', 'pt_applicable'] as const).map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} />{k.split('_')[0].toUpperCase()} applicable</label>)}
      </div>
    </Dialog>
  )
}

function ProfileLeave({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ['leave', 'emp', employeeId], queryFn: () => unwrap<any[]>(db.from('v_leave_register').select('*').eq('employee_id', employeeId).order('start_date', { ascending: false })) })
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Leave history" columns={[
    { key: 'leave_type_name', header: 'Type' }, { key: 'start_date', header: 'From', cell: (r) => fmtDate(r.start_date) }, { key: 'end_date', header: 'To', cell: (r) => fmtDate(r.end_date) },
    { key: 'days', header: 'Days', className: 'tnum' }, { key: 'reason', header: 'Reason', hideOnMobile: true }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ]} />
}

function ProfilePayroll({ employeeId }: { employeeId: string }) {
  const { can } = useAuth()
  const sal = useQuery({ queryKey: ['payroll', 'assign', employeeId], queryFn: () => unwrap<any[]>(db.from('employee_salary_assignments').select('*, salary_structures(name)').eq('employee_id', employeeId).order('effective_from', { ascending: false })) })
  const slips = useQuery({ queryKey: ['payroll', 'slips', employeeId], queryFn: () => unwrap<any[]>(db.from('payslips').select('*, payroll_entries(gross_earnings, total_deductions, net_pay, lop_days)').eq('employee_id', employeeId).order('period_month', { ascending: false })) })
  if (!sal.isLoading && (sal.data ?? []).length === 0 && !can('payroll.view')) return <EmptyState title="Salary information is restricted" description="Only the employee and payroll administrators can see salary details." />
  return (
    <div className="space-y-4">
      <DataTable rows={sal.data} loading={sal.isLoading} searchable={false} columns={[
        { key: 'structure', header: 'Structure', value: (r) => r.salary_structures?.name }, { key: 'monthly_gross', header: 'Monthly gross', cell: (r) => money(r.monthly_gross) },
        { key: 'annual_ctc', header: 'Annual CTC', cell: (r) => money(r.annual_ctc) }, { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) },
        { key: 'effective_to', header: 'To', cell: (r) => (r.effective_to ? fmtDate(r.effective_to) : 'Current') },
      ]} emptyTitle="No salary assigned" />
      <DataTable rows={slips.data} loading={slips.isLoading} searchable={false} columns={[
        { key: 'period_month', header: 'Month', cell: (r) => fmtDate(r.period_month, 'MMM yyyy') }, { key: 'gross', header: 'Gross', value: (r) => r.payroll_entries?.gross_earnings, cell: (r) => money(r.payroll_entries?.gross_earnings) },
        { key: 'ded', header: 'Deductions', value: (r) => r.payroll_entries?.total_deductions, cell: (r) => money(r.payroll_entries?.total_deductions) },
        { key: 'net', header: 'Net pay', value: (r) => r.payroll_entries?.net_pay, cell: (r) => <span className="font-medium">{money(r.payroll_entries?.net_pay)}</span> },
        { key: 'lop', header: 'LOP days', value: (r) => r.payroll_entries?.lop_days },
      ]} emptyTitle="No payslips yet" />
    </div>
  )
}

function ProfileClaims({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ['claims', 'emp', employeeId], queryFn: () => unwrap<any[]>(db.from('v_claims_register').select('*').eq('employee_id', employeeId).order('expense_date', { ascending: false })) })
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={[
    { key: 'claim_number', header: 'Claim' }, { key: 'title', header: 'Title' }, { key: 'category_name', header: 'Category' }, { key: 'expense_date', header: 'Date', cell: (r) => fmtDate(r.expense_date) },
    { key: 'amount', header: 'Amount', cell: (r) => money(r.amount) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ]} />
}

function ProfilePerformance({ employeeId }: { employeeId: string }) {
  const goals = useQuery({ queryKey: ['performance', 'goals', employeeId], queryFn: () => unwrap<any[]>(db.from('performance_goals').select('*, appraisal_cycles(name)').eq('employee_id', employeeId).order('created_at', { ascending: false })) })
  const finals = useQuery({ queryKey: ['performance', 'finals', employeeId], queryFn: () => unwrap<any[]>(db.from('appraisal_finals').select('*, appraisal_cycles(name, period_end)').eq('employee_id', employeeId)) })
  return (
    <div className="space-y-4">
      {(finals.data ?? []).length > 0 && <Card className="p-5"><h3 className="mb-3 text-sm font-semibold">Results</h3><div className="flex flex-wrap gap-3">{finals.data!.map((f) => <div key={f.id} className="rounded-lg border border-line p-3"><div className="text-xs text-muted">{f.appraisal_cycles?.name}</div><div className="figure text-2xl">{f.final_rating ?? '—'}<span className="text-sm text-muted">/5</span></div><StatusBadge status={f.status} /></div>)}</div></Card>}
      <DataTable rows={goals.data} loading={goals.isLoading} columns={[
        { key: 'title', header: 'Goal' }, { key: 'cycle', header: 'Cycle', value: (r) => r.appraisal_cycles?.name }, { key: 'weight', header: 'Weight', value: (r) => `${r.weight}%` },
        { key: 'progress', header: 'Progress', value: (r) => r.progress, cell: (r) => <div className="flex w-32 items-center gap-2"><Progress value={r.progress} /><span className="text-xs tnum">{r.progress}%</span></div> },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} emptyTitle="No goals" />
    </div>
  )
}

function ProfileLearning({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ['learning', 'emp', employeeId], queryFn: () => unwrap<any[]>(db.from('v_training_register').select('*').eq('employee_id', employeeId)) })
  return <DataTable rows={q.data} loading={q.isLoading} columns={[
    { key: 'course_title', header: 'Course' }, { key: 'source', header: 'Source', value: (r) => titleCase(r.source) },
    { key: 'progress', header: 'Progress', value: (r) => r.progress, cell: (r) => <div className="flex w-32 items-center gap-2"><Progress value={r.progress} tone={r.status === 'completed' ? 'success' : 'primary'} /><span className="text-xs tnum">{r.progress}%</span></div> },
    { key: 'due_date', header: 'Due', cell: (r) => fmtDate(r.due_date) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'certificate_number', header: 'Certificate' },
  ]} emptyTitle="No courses" />
}

function ProfileActivity({ employeeId }: { employeeId: string }) {
  const q = useQuery({ queryKey: ['employee', employeeId, 'activity'], queryFn: () => unwrap<any[]>(db.from('approval_requests').select('id, entity_type, title, status, submitted_at').eq('requester_employee_id', employeeId).order('submitted_at', { ascending: false }).limit(100)) })
  return (
    <div className="space-y-4">
      <HistoryTable employeeId={employeeId} />
      <Card><CardHeader title="Requests" />
        <QueryView q={q} empty={{ when: (d) => d.length === 0, title: 'No requests yet' }}>
          {(d) => <ul className="divide-y divide-line">{d.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"><span>{r.title}</span><span className="flex items-center gap-2"><StatusBadge status={r.status} /><span className="text-xs text-subtle">{ago(r.submitted_at)}</span></span></li>)}</ul>}
        </QueryView>
      </Card>
    </div>
  )
}

function HistoryTable({ employeeId }: { employeeId?: string }) {
  const q = useQuery({
    queryKey: ['employee-history', employeeId ?? 'all'],
    queryFn: async () => {
      let query = db.from('employee_employment_history').select('*, employees!employee_employment_history_employee_id_fkey(first_name, last_name, employee_code), from_d:departments!employee_employment_history_from_department_id_fkey(name), to_d:departments!employee_employment_history_to_department_id_fkey(name), from_g:designations!employee_employment_history_from_designation_id_fkey(name), to_g:designations!employee_employment_history_to_designation_id_fkey(name)').order('effective_date', { ascending: false }).limit(1000)
      if (employeeId) query = query.eq('employee_id', employeeId)
      return unwrap<any[]>(query)
    },
  })
  const change = (r: any) => [r.from_d?.name !== r.to_d?.name && r.to_d && `${r.from_d?.name ?? '—'} → ${r.to_d.name}`, r.from_g?.name !== r.to_g?.name && r.to_g && `${r.from_g?.name ?? '—'} → ${r.to_g.name}`,
    r.to_status && `${r.from_status ?? '—'} → ${r.to_status}`].filter(Boolean).join(' · ')
  return <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Employment history" columns={[
    { key: 'effective_date', header: 'Effective', cell: (r) => fmtDate(r.effective_date) },
    ...(!employeeId ? [{ key: 'emp', header: 'Employee', value: (r: any) => `${r.employees?.first_name} ${r.employees?.last_name}` } as Column<any>] : []),
    { key: 'event_type', header: 'Event', cell: (r) => <Badge tone="primary">{titleCase(r.event_type)}</Badge>, value: (r) => r.event_type },
    { key: 'change', header: 'Change', value: change }, { key: 'remarks', header: 'Remarks', hideOnMobile: true },
  ]} emptyTitle="No history recorded" />
}

export function EmployeeHistoryPage() {
  return <div><PageHeader title="Employee history" description="Joining, confirmations, transfers, promotions, salary revisions and exits — never deleted." /><HistoryTable /></div>
}

// ---------------- master data ----------------
export const departmentsCfg: CrudConfig = {
  title: 'Departments', description: 'Organisation units. Department heads can be approvers in workflows.',
  table: 'departments', select: '*, parent:parent_id(name), head:employees!departments_head_fk(first_name, last_name)', permission: 'employees.manage',
  filter: (q) => q.is('deleted_at', null), orderBy: { column: 'name' }, remove: { column: 'deleted_at', value: new Date().toISOString() },
  columns: [{ key: 'name', header: 'Department' }, { key: 'code', header: 'Code' }, { key: 'parent', header: 'Parent', value: (r) => r.parent?.name },
    { key: 'head', header: 'Head', value: (r) => (r.head ? `${r.head.first_name} ${r.head.last_name}` : null) }, { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') }],
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'code', label: 'Code', type: 'text' },
    { name: 'parent_id', label: 'Parent department', type: 'lookup', lookup: { table: 'departments', filter: (q) => q.is('deleted_at', null) } },
    { name: 'head_employee_id', label: 'Department head', type: 'employee' }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
}
export const designationsCfg: CrudConfig = {
  title: 'Designations', description: 'Job titles and levels. Expense policies can differ by designation.',
  table: 'designations', select: '*, departments(name)', permission: 'employees.manage', filter: (q) => q.is('deleted_at', null), orderBy: { column: 'level', ascending: false },
  remove: { column: 'deleted_at', value: new Date().toISOString() },
  columns: [{ key: 'name', header: 'Designation' }, { key: 'level', header: 'Level', className: 'tnum' }, { key: 'department', header: 'Department', value: (r) => r.departments?.name ?? 'Any' }, { key: 'description', header: 'Description', hideOnMobile: true }],
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'level', label: 'Level (1 = entry)', type: 'number', min: 1, max: 20, required: true, default: 1 },
    { name: 'department_id', label: 'Department', type: 'lookup', lookup: { table: 'departments', filter: (q) => q.is('deleted_at', null) } }, { name: 'description', label: 'Description', type: 'textarea' }],
}
export const DepartmentsPage = () => <CrudPage cfg={departmentsCfg} />
export const DesignationsPage = () => <CrudPage cfg={designationsCfg} />

// ---------------- structure & hierarchy ----------------
export function OrgStructure() {
  const deps = useQuery({ queryKey: ['crud', 'departments', 'tree'], queryFn: () => unwrap<any[]>(db.from('departments').select('id, name, parent_id, head_employee_id').is('deleted_at', null)) })
  const dir = useDirectory()
  const byParent = useMemo(() => { const m = new Map<string | null, any[]>(); for (const d of deps.data ?? []) m.set(d.parent_id, [...(m.get(d.parent_id) ?? []), d]); return m }, [deps.data])
  const people = dir.data ?? []
  const Node = ({ d, depth }: { d: any; depth: number }) => {
    const members = people.filter((p) => (p.department_ids?.length ? p.department_ids.includes(d.id) : p.department_id === d.id))
    const head = people.find((p) => p.id === d.head_employee_id)
    return (
      <div className={cn(depth > 0 && 'ml-6 border-l border-line pl-4')}>
        <Card className="mb-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /><span className="font-semibold">{d.name}</span><Badge>{members.length} people</Badge></div>
            {head && <span className="text-sm text-muted">Head: <span className="text-text">{head.full_name}</span></span>}
          </div>
          {members.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{members.map((m) => <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-xs"><Avatar name={m.full_name} src={m.photo_url} size={20} />{m.full_name}</span>)}</div>}
        </Card>
        {(byParent.get(d.id) ?? []).map((c) => <Node key={c.id} d={c} depth={depth + 1} />)}
      </div>
    )
  }
  return (
    <div><PageHeader title="Organisation structure" description="Departments, their heads and members." />
      <QueryView q={deps} empty={{ when: (d) => d.length === 0, title: 'No departments yet' }}>{() => <div>{(byParent.get(null) ?? []).map((d) => <Node key={d.id} d={d} depth={0} />)}</div>}</QueryView>
    </div>
  )
}

export function ReportingHierarchy() {
  const dir = useDirectory()
  const people = dir.data ?? []
  const kids = useMemo(() => { const m = new Map<string | null, DirectoryRow[]>(); for (const p of people) { const k = people.some((x) => x.id === p.reporting_manager_id) ? p.reporting_manager_id : null; m.set(k, [...(m.get(k) ?? []), p]) } return m }, [people])
  const Node = ({ p }: { p: DirectoryRow }) => {
    const reports = kids.get(p.id) ?? []
    return (
      <li className="relative">
        <div className="inline-flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 shadow-card">
          <Avatar name={p.full_name} src={p.photo_url} size={30} />
          <div><div className="text-sm font-medium">{p.full_name}</div><div className="text-xs text-muted">{p.designation_name ?? '—'}{reports.length > 0 && ` · ${reports.length} direct report${reports.length > 1 ? 's' : ''}`}</div></div>
        </div>
        {reports.length > 0 && <ul className="ml-5 mt-2 space-y-2 border-l border-line pl-5">{reports.map((r) => <Node key={r.id} p={r} />)}</ul>}
      </li>
    )
  }
  return (
    <div><PageHeader title="Reporting hierarchy" description="Who reports to whom. Approval workflows route to reporting managers automatically." />
      <QueryView q={dir}>{() => <ul className="space-y-3">{(kids.get(null) ?? []).map((p) => <Node key={p.id} p={p} />)}</ul>}</QueryView>
    </div>
  )
}

// ---------------- documents ----------------
export function DocumentsList({ employeeId }: { employeeId?: string }) {
  const { can } = useAuth()
  const { orgId, employeeId: me } = useMe()
  const [params] = useSearchParams()
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [uploading, setUploading] = useState(false)
  const q = useQuery({
    queryKey: ['documents', employeeId ?? 'all', status],
    queryFn: async () => {
      let query = db.from('employee_documents').select('*, employees(first_name, last_name, employee_code), document_types(name)').is('deleted_at', null).order('created_at', { ascending: false }).limit(1000)
      if (employeeId) query = query.eq('employee_id', employeeId)
      if (status) query = query.eq('verification_status', status)
      return unwrap<any[]>(query)
    },
  })
  const verify = useAction(({ id, s, remarks }: { id: string; s: string; remarks?: string }) => unwrap(db.from('employee_documents').update({ verification_status: s, verified_at: new Date().toISOString(), remarks: remarks ?? null }).eq('id', id).select('id')), { success: 'Document updated', invalidate: [['documents']] })
  const confirm = useConfirm()
  const remove = useAction(async (id: string) => {
    const path = await rpc<string>('delete_employee_document', { p_id: id })
    await supabase.storage.from('employee-documents').remove([path])   // best effort: the record is already gone
  }, { success: 'Document deleted', invalidate: [['documents']] })
  const canDelete = (r: any) => can('employees.documents') || (r.employee_id === me && r.verification_status !== 'verified')
  const askDelete = async (r: any) => {
    if ((await confirm({ title: `Delete "${r.title}"?`, description: 'The file is removed for good. Upload it again if it is needed later.', danger: true, confirmLabel: 'Delete' })).ok) remove.mutate(r.id)
  }
  return (
    <div>
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Employee documents" columns={[
        { key: 'title', header: 'Document', cell: (r) => <button className="flex items-center gap-1.5 font-medium text-primary hover:underline" onClick={() => openFile('employee-documents', r.storage_path)}>{r.title}<ExternalLink className="h-3 w-3" /></button>, value: (r) => r.title },
        ...(!employeeId ? [{ key: 'emp', header: 'Employee', value: (r: any) => `${r.employees?.first_name} ${r.employees?.last_name}` } as Column<any>] : []),
        { key: 'type', header: 'Type', value: (r) => r.document_types?.name }, { key: 'expiry_date', header: 'Expires', cell: (r) => fmtDate(r.expiry_date), hideOnMobile: true },
        { key: 'created_at', header: 'Uploaded', cell: (r) => fmtDate(r.created_at), hideOnMobile: true },
        { key: 'verification_status', header: 'Verification', cell: (r) => <StatusBadge status={r.verification_status} /> },
        { key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r: any) => (
          <div className="flex justify-end gap-1">
            {can('employees.documents') && r.verification_status === 'pending' && <>
              <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: 'Reject document?', requireReason: true }); if (c.ok) verify.mutate({ id: r.id, s: 'rejected', remarks: c.reason }) }}>Reject</Button>
              <Button size="sm" variant="success" onClick={() => verify.mutate({ id: r.id, s: 'verified' })}><CheckCircle2 /> Verify</Button></>}
            {canDelete(r) && <Button size="sm" variant="ghost" aria-label={`Delete ${r.title}`} title="Delete" onClick={() => askDelete(r)}><Trash2 className="text-danger" /></Button>}
          </div>) } as Column<any>,
      ]} toolbar={<>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Verification status"><option value="">All</option><option value="pending">Pending verification</option><option value="verified">Verified</option><option value="rejected">Rejected</option></Select>
        <Button size="sm" onClick={() => setUploading(true)} className="ml-auto"><FileUp /> Upload</Button>
      </>} emptyTitle="No documents" />
      {uploading && <UploadDocDialog employeeId={employeeId ?? me} orgId={orgId} onClose={() => setUploading(false)} pickEmployee={!employeeId && can('employees.documents')} />}
    </div>
  )
}

function UploadDocDialog({ employeeId, orgId, onClose, pickEmployee }: { employeeId: string; orgId: string; onClose: () => void; pickEmployee?: boolean }) {
  const [emp, setEmp] = useState<string | null>(employeeId)
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState('')
  const [type, setType] = useState<string | null>(null)
  const [expiry, setExpiry] = useState('')
  const save = useAction(async () => {
    const f = files[0]
    const up = await uploadFileDetailed('employee-documents', orgId, emp!, f)
    // no .select(): an employee's own new row is readable, but keep it simple and robust
    return unwrap(db.from('employee_documents').insert({ employee_id: emp, document_type_id: type, title: title || f.name, storage_path: up.path, file_name: up.name, mime_type: up.type, size_bytes: up.size, expiry_date: expiry || null }))
  }, { success: 'Document uploaded', invalidate: [['documents']], onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Upload document" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!files.length || !emp} onClick={() => save.mutate()}>Upload</Button></>}>
      <div className="space-y-4">
        {pickEmployee && <Field label="Employee" required><EmployeePicker value={emp} onChange={setEmp} /></Field>}
        <Field label="Document type"><LookupSelect def={{ name: 'type', label: 'Type', type: 'lookup', lookup: { table: 'document_types' } }} value={type} onChange={setType} /></Field>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" /></Field>
        <Field label="Expiry date"><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
        <FileDrop files={files} onChange={setFiles} multiple={false} label="Choose file" />
        <p className="text-xs text-muted">Files are stored privately and opened through short-lived signed links.</p>
      </div>
    </Dialog>
  )
}

export function DocumentsPage() {
  return <div><PageHeader title="Employee documents" description="Identity, education and employment documents. HR verifies uploads; employees can upload their own from self-service." /><DocumentsList /></div>
}

// ---------------- lifecycle & transfers ----------------
export function LifecyclePage() {
  const dir = useDirectory(true)
  const rows = dir.data ?? []
  const stages = ['onboarding', 'probation', 'active', 'notice', 'exited', 'inactive']
  return (
    <div className="space-y-5">
      <PageHeader title="Employee lifecycle" description="Where everyone is in their journey, from onboarding to exit." />
      <StatStrip items={stages.map((s) => ({ label: titleCase(s), value: rows.filter((r) => r.status === s).length }))} />
      <div className="grid gap-4 lg:grid-cols-3">
        {['onboarding', 'probation', 'notice'].map((s) => (
          <Card key={s}><CardHeader title={titleCase(s)} description={s === 'probation' ? 'Confirm from the employee profile' : s === 'notice' ? 'Serving notice — see offboarding' : 'Joining in progress'} />
            <ul className="divide-y divide-line">{rows.filter((r) => r.status === s).map((r) => <li key={r.id} className="px-5 py-2.5"><Link to={`/employees/${r.id}`} className="hover:underline"><EmployeeCell name={r.full_name} photo={r.photo_url} sub={`${r.designation_name ?? '—'} · joined ${fmtDate(r.date_of_joining)}`} /></Link></li>)}
              {rows.filter((r) => r.status === s).length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">None</li>}</ul>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function TransfersPage() {
  const [emp, setEmp] = useState<string | null>(null)
  const [event, setEvent] = useState('transfer')
  const [eff, setEff] = useState(new Date().toISOString().slice(0, 10))
  const [dep, setDep] = useState<string | null>(null), [des, setDes] = useState<string | null>(null), [mgr, setMgr] = useState<string | null>(null), [loc, setLoc] = useState<string | null>(null)
  const [remarks, setRemarks] = useState('')
  const save = useAction(() => rpc('transfer_employee', { p_employee: emp, p_event: event, p_effective: eff, p_department: dep, p_designation: des, p_manager: mgr, p_location: loc, p_remarks: remarks || null }), {
    success: 'Change recorded', invalidate: [['employee-history'], ['directory']], onSuccess: () => { setDep(null); setDes(null); setMgr(null); setLoc(null); setRemarks('') },
  })
  return (
    <div className="space-y-5">
      <PageHeader title="Employee transfers" description="Move employees between departments, roles, managers or locations. Each change is kept in their history; circular reporting lines are blocked." />
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee" required className="lg:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
          <Field label="Change type"><Select value={event} onChange={(e) => setEvent(e.target.value)}>{['transfer', 'promotion', 'department_change', 'manager_change', 'location_change'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
          <Field label="Effective date"><Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
          <Field label="New department"><LookupSelect def={{ name: 'd', label: 'Department', type: 'lookup', lookup: { table: 'departments', filter: (q) => q.is('deleted_at', null) } }} value={dep} onChange={setDep} /></Field>
          <Field label="New designation"><LookupSelect def={{ name: 'g', label: 'Designation', type: 'lookup', lookup: { table: 'designations', filter: (q) => q.is('deleted_at', null) } }} value={des} onChange={setDes} /></Field>
          <Field label="New manager"><EmployeePicker value={mgr} onChange={setMgr} allowClear filter={(x: any) => x.id !== emp} /></Field>
          <Field label="New location"><LookupSelect def={{ name: 'l', label: 'Location', type: 'lookup', lookup: { table: 'locations' } }} value={loc} onChange={setLoc} /></Field>
          <Field label="Remarks" className="sm:col-span-2 lg:col-span-3"><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </div>
        <Button className="mt-4" loading={save.isPending} disabled={!emp || !(dep || des || mgr || loc)} onClick={() => save.mutate()}><ArrowLeftRight /> Record change</Button>
      </Card>
      <HistoryTable />
    </div>
  )
}
