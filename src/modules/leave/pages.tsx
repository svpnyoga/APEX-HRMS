import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { endOfMonth, isWithinInterval, parseISO, startOfMonth } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { CalendarPlus, Play, SlidersHorizontal, XCircle, Coins } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup, useRpc } from '@/hooks/data'
import { uploadFile } from '@/lib/storage'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { MonthCalendar, MonthNav } from '@/components/common/calendar'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { CrudPage, type CrudConfig } from '@/components/crud/CrudPage'
import { FileDrop } from '@/components/common/upload'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader } from '@/components/ui/misc'
import { cn, fmtDate, isoDate, titleCase, money } from '@/lib/utils'
import { ApprovalsInbox, MyRequestStatus } from '@/modules/approvals/Inbox'
import { holidaysCfg } from '@/modules/attendance/pages'

const year = new Date().getFullYear()

export function useLeaveRegister(filter?: (q: any) => any, key = 'all') {
  return useQuery({
    queryKey: ['leave', 'register', key],
    queryFn: async () => {
      let q: any = db.from('v_leave_register').select('*').order('start_date', { ascending: false }).limit(3000)
      if (filter) q = filter(q)
      return unwrap<any[]>(q)
    },
  })
}

export function LeaveDashboard() {
  const reg = useLeaveRegister()
  const rows = reg.data ?? []
  const today = isoDate()
  const yr = rows.filter((r) => r.start_date.startsWith(String(year)) && r.status === 'approved')
  const byType = Object.entries(yr.reduce((a: Record<string, number>, r) => ({ ...a, [r.leave_type_name]: (a[r.leave_type_name] ?? 0) + Number(r.days) }), {})).map(([name, value]) => ({ name, value }))
  const byDept = Object.entries(yr.reduce((a: Record<string, number>, r) => ({ ...a, [r.department_name ?? '—']: (a[r.department_name ?? '—'] ?? 0) + Number(r.days) }), {})).map(([name, days]) => ({ name, days }))
  return (
    <div className="space-y-5">
      <PageHeader title="Leave dashboard" description={`Leave activity for ${year}.`} />
      <StatStrip items={[
        { label: 'On leave today', value: rows.filter((r) => r.status === 'approved' && r.start_date <= today && r.end_date >= today).length, tone: 'primary', to: '/leave/calendar' },
        { label: 'Pending applications', value: rows.filter((r) => r.status === 'pending').length, tone: 'warning', to: '/leave/approvals' },
        { label: 'Upcoming (next 14 days)', value: rows.filter((r) => r.status === 'approved' && r.start_date > today && r.start_date <= isoDate(new Date(Date.now() + 14 * 864e5))).length },
        { label: `Days taken in ${year}`, value: yr.reduce((a, r) => a + Number(r.days), 0) },
        { label: 'Unpaid days', value: yr.filter((r) => !r.is_paid).reduce((a, r) => a + Number(r.days), 0), tone: 'danger' },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Days by leave type" height={280}>
          <ResponsiveContainer><PieChart><Pie data={byType} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>{byType.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}</Pie><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Days by department" height={280}>
          <ResponsiveContainer><BarChart data={byDept}><CartesianGrid {...GRID} /><XAxis dataKey="name" {...AXIS} interval={0} angle={-15} textAnchor="end" height={50} /><YAxis {...AXIS} width={30} /><Tooltip {...TOOLTIP} /><Bar dataKey="days" fill={SERIES[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

export const leaveCols = (withEmployee = true, onCancel?: (r: any) => void, onDetail?: (r: any) => void): Column<any>[] => [
  ...(withEmployee ? [{ key: 'employee_name', header: 'Employee', cell: (r: any) => <EmployeeCell name={r.employee_name} sub={r.department_name} /> } as Column<any>] : []),
  { key: 'leave_type_name', header: 'Type', cell: (r) => <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.leave_type_name}</span> },
  { key: 'start_date', header: 'Dates', value: (r) => r.start_date, cell: (r) => <span className="tnum">{fmtDate(r.start_date, 'dd MMM')}{r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date, 'dd MMM yyyy')}` : ` ${fmtDate(r.start_date, 'yyyy')}`}{r.is_half_day && <Badge className="ml-1.5">{r.half_day_session === 'first_half' ? '1st half' : '2nd half'}</Badge>}</span> },
  { key: 'days', header: 'Days', className: 'tnum' },
  { key: 'reason', header: 'Reason', hideOnMobile: true, cell: (r) => <span className="line-clamp-1 max-w-xs">{r.reason}</span> },
  { key: 'applied_at', header: 'Applied', cell: (r) => fmtDate(r.applied_at), hideOnMobile: true },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  ...(onCancel || onDetail ? [{ key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r: any) => (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {onDetail && <Button size="sm" variant="ghost" onClick={() => onDetail(r)}>History</Button>}
      {onCancel && ['pending', 'approved'].includes(r.status) && r.end_date >= isoDate() && <Button size="sm" variant="ghost" onClick={() => onCancel(r)}><XCircle /> Cancel</Button>}
    </div>
  ) } as Column<any>] : []),
]

export function useCancelLeave() {
  const confirm = useConfirm()
  const act = useAction(({ id, reason }: { id: string; reason?: string }) => rpc('cancel_leave', { p_id: id, p_reason: reason ?? null }), { success: 'Leave cancelled and balance restored', invalidate: [['leave'], ['my-home'], ['approvals']] })
  return async (r: any) => {
    const c = await confirm({ title: r.status === 'pending' ? 'Withdraw this application?' : 'Cancel approved leave?', description: r.status === 'approved' ? 'The days are credited back to your balance.' : undefined, confirmLabel: 'Cancel leave', danger: true, requireReason: r.status === 'approved' })
    if (c.ok) act.mutate({ id: r.id, reason: c.reason })
  }
}

export function LeaveApplicationsPage() {
  const { can } = useAuth()
  const [status, setStatus] = useState('')
  const reg = useLeaveRegister(status ? (q) => q.eq('status', status) : undefined, `apps-${status}`)
  const cancel = useCancelLeave()
  const [detail, setDetail] = useState<any | null>(null)
  return (
    <div>
      <PageHeader title="Leave applications" description="All applications you can see. Cancelling approved leave credits the balance back through the ledger." />
      <DataTable rows={reg.data} columns={leaveCols(true, can('leave.manage') ? cancel : undefined, setDetail)} loading={reg.isLoading} error={reg.error} exportName="Leave applications"
        toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status"><option value="">All statuses</option>{['pending', 'approved', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>} />
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title="Approval history" description={detail ? `${detail.employee_name} · ${detail.leave_type_name}` : ''}>{detail && <MyRequestStatus entityType="leave" entityId={detail.id} />}</Dialog>
    </div>
  )
}

export function ApplyLeaveForm({ onDone }: { onDone?: () => void }) {
  const { orgId, employeeId } = useMe()
  const home = useRpc<any>(['my-home'], 'my_home')
  const types = useLookup<any>('leave_types', 'id, name, code, allow_half_day, requires_balance, document_required_after_days, color, gender_restriction', 'name', (q) => q.eq('is_active', true))
  const [type, setType] = useState('')
  const [start, setStart] = useState(isoDate()); const [end, setEnd] = useState(isoDate())
  const [half, setHalf] = useState(false); const [session, setSession] = useState('first_half')
  const [reason, setReason] = useState(''); const [files, setFiles] = useState<File[]>([])
  const lt = (types.data ?? []).find((t) => t.id === type)
  const bal = (home.data?.balances ?? []).find((b: any) => b.leave_type_id === type)
  const submit = useAction(async () => {
    const doc = files[0] ? await uploadFile('employee-documents', orgId, employeeId, files[0]) : null
    return rpc('apply_leave', { p_leave_type: type, p_start: start, p_end: half ? start : end, p_half: half, p_session: half ? session : null, p_reason: reason, p_document_path: doc })
  }, { success: 'Leave applied — your manager has been notified', invalidate: [['leave'], ['my-home']], onSuccess: () => { setReason(''); setFiles([]); onDone?.() } })
  const calendarDays = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 864e5 + 1)
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {(home.data?.balances ?? []).map((b: any) => (
          <button key={b.leave_type_id} type="button" onClick={() => setType(b.leave_type_id)} className={cn('rounded-lg border p-3 text-left transition-colors', type === b.leave_type_id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-raised')}>
            <div className="flex items-center gap-1.5 text-xs text-muted"><span className="h-2 w-2 rounded-full" style={{ background: b.color }} />{b.name}</div>
            <div className="figure mt-1 text-2xl">{Number(b.available)}<span className="ml-1 text-xs font-normal text-muted">available</span></div>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Leave type" required className="sm:col-span-2">
          <Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Select…</option>{(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        </Field>
        <Field label="From" required><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value) }} /></Field>
        <Field label="To" required><Input type="date" value={half ? start : end} min={start} disabled={half} onChange={(e) => setEnd(e.target.value)} /></Field>
        {lt?.allow_half_day && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Half day</label>
            {half && <Select value={session} onChange={(e) => setSession(e.target.value)} className="w-auto"><option value="first_half">First half</option><option value="second_half">Second half</option></Select>}
          </div>
        )}
        <Field label="Reason" required className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="sm:col-span-2">
          <FileDrop files={files} onChange={setFiles} multiple={false} label={lt?.document_required_after_days ? `Supporting document (required beyond ${lt.document_required_after_days} days)` : 'Supporting document (optional)'} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-raised px-4 py-3 text-sm">
        <span className="text-muted">{half ? '0.5 day' : `${calendarDays} calendar day${calendarDays === 1 ? '' : 's'}`} · weekly offs and holidays are excluded automatically{bal ? ` · ${Number(bal.available)} available` : ''}</span>
        <Button loading={submit.isPending} disabled={!type || !reason.trim()} onClick={() => submit.mutate()}><CalendarPlus /> Apply</Button>
      </div>
    </div>
  )
}

export function ApplyLeavePage() {
  const { employeeId } = useMe()
  const mine = useLeaveRegister((q) => q.eq('employee_id', employeeId), `mine-${employeeId}`)
  const cancel = useCancelLeave()
  return (
    <div className="space-y-5">
      <PageHeader title="Apply for leave" description="Balances update only after final approval. Overlapping dates and insufficient balance are rejected." />
      <Card className="p-5"><ApplyLeaveForm /></Card>
      <Card><CardHeader title="My applications" /><div className="p-3"><DataTable rows={mine.data} columns={leaveCols(false, cancel)} loading={mine.isLoading} searchable={false} emptyTitle="No applications yet" /></div></Card>
    </div>
  )
}

export const LeaveApprovalsPage = () => <ApprovalsInbox title="Leave approvals" description="Leave, encashment and attendance requests waiting for you. Approve or reject with a comment." entityTypes={['leave', 'leave_encashment', 'attendance_regularisation', 'attendance_permission', 'expense_claim', 'payroll_run', 'salary_revision', 'appraisal', 'onboarding', 'resignation']} />

export const leaveTypesCfg: CrudConfig = {
  title: 'Leave types', description: 'Paid/unpaid types, half-day rules, document requirements and restrictions.',
  table: 'leave_types', permission: 'leave.manage', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
  columns: [
    { key: 'name', header: 'Leave type', cell: (r) => <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}<span className="text-xs text-subtle">{r.code}</span>{!r.is_active && <Badge>Archived</Badge>}</span> },
    { key: 'is_paid', header: 'Paid', value: (r) => (r.is_paid ? 'Paid' : 'Unpaid') }, { key: 'requires_balance', header: 'Needs balance', value: (r) => (r.requires_balance ? 'Yes' : 'No') },
    { key: 'allow_half_day', header: 'Half day', value: (r) => (r.allow_half_day ? 'Allowed' : 'No') },
    { key: 'document_required_after_days', header: 'Document after', value: (r) => (r.document_required_after_days ? `${r.document_required_after_days} days` : '—') },
    { key: 'gender_restriction', header: 'Restricted to', value: (r) => titleCase(r.gender_restriction) || 'Everyone' },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true }, { name: 'code', label: 'Code', type: 'text', required: true },
    { name: 'is_paid', label: 'Paid leave', type: 'switch', default: true }, { name: 'requires_balance', label: 'Requires balance', type: 'switch', default: true },
    { name: 'allow_half_day', label: 'Allow half day', type: 'switch', default: true }, { name: 'allow_negative_balance', label: 'Allow negative balance', type: 'switch' },
    { name: 'document_required_after_days', label: 'Document required beyond (days)', type: 'number', min: 0 }, { name: 'max_consecutive_days', label: 'Max consecutive days', type: 'number', min: 1 },
    { name: 'min_notice_days', label: 'Minimum notice (days)', type: 'number', min: 0, default: 0, required: true },
    { name: 'gender_restriction', label: 'Restricted to', type: 'select', options: [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }] },
    { name: 'color', label: 'Colour', type: 'color', default: '#4338CA' }, { name: 'is_active', label: 'Active', type: 'switch', default: true },
  ],
}
export const LeaveTypesPage = () => <CrudPage cfg={leaveTypesCfg} />

export const LeavePoliciesPage = () => <CrudPage cfg={{
  title: 'Leave policies', description: 'Entitlement, accrual frequency, carry forward and encashment rules. Effective-dated.',
  table: 'leave_policies', select: '*, leave_types(name)', permission: 'leave.manage', orderBy: { column: 'effective_from', ascending: false }, remove: { column: 'is_active', value: false },
  columns: [
    { key: 'name', header: 'Policy' }, { key: 'lt', header: 'Leave type', value: (r) => r.leave_types?.name }, { key: 'annual_entitlement', header: 'Per year', value: (r) => `${r.annual_entitlement} days` },
    { key: 'accrual_frequency', header: 'Accrual', value: (r) => titleCase(r.accrual_frequency) }, { key: 'carry_forward_max', header: 'Carry forward', value: (r) => `${r.carry_forward_max} days` },
    { key: 'encashable', header: 'Encashable', value: (r) => (r.encashable ? `Up to ${r.encash_max_days} days` : 'No') }, { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) },
  ],
  fields: [
    { name: 'name', label: 'Policy name', type: 'text', required: true }, { name: 'leave_type_id', label: 'Leave type', type: 'lookup', lookup: { table: 'leave_types' }, required: true },
    { name: 'annual_entitlement', label: 'Annual entitlement (days)', type: 'number', min: 0, required: true },
    { name: 'accrual_frequency', label: 'Accrual', type: 'select', required: true, default: 'monthly', options: ['monthly', 'quarterly', 'annual', 'none'].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: 'carry_forward_max', label: 'Max carry forward (days)', type: 'number', min: 0, default: 0, required: true }, { name: 'min_service_days', label: 'Eligible after (days of service)', type: 'number', min: 0, default: 0, required: true },
    { name: 'encashable', label: 'Encashable', type: 'switch' }, { name: 'encash_max_days', label: 'Max encashment (days)', type: 'number', min: 0, default: 0, showIf: (v) => !!v.encashable },
    { name: 'employment_types', label: 'Applies to', type: 'tags', default: ['full_time', 'part_time', 'contract', 'intern', 'consultant', 'trainee'], options: ['full_time', 'part_time', 'contract', 'intern', 'consultant', 'trainee'].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'effective_to', label: 'Effective to', type: 'date' }, { name: 'is_active', label: 'Active', type: 'switch', default: true },
  ],
}} />

export function LeaveBalancesPage() {
  const { can } = useAuth()
  const [yr, setYr] = useState(year)
  const q = useQuery({ queryKey: ['leave', 'balances', yr], queryFn: () => unwrap<any[]>(db.from('v_leave_balances').select('*').eq('leave_year', yr).order('employee_name')) })
  const [adj, setAdj] = useState(false)
  return (
    <div>
      <PageHeader title="Leave balances" description="Opening + accrued + adjustments − used − encashed − lapsed. Every change is a ledger entry."
        actions={can('leave.manage') && <Button variant="secondary" onClick={() => setAdj(true)}><SlidersHorizontal /> Adjust balance</Button>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName={`Leave balances ${yr}`} rowKey="leave_type_id" columns={[
        { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} sub={r.department_name} /> }, { key: 'leave_type_name', header: 'Type' },
        { key: 'opening', header: 'Opening', className: 'tnum' }, { key: 'accrued', header: 'Accrued', className: 'tnum' }, { key: 'adjusted', header: 'Adjusted', className: 'tnum' },
        { key: 'used', header: 'Used', className: 'tnum' }, { key: 'encashed', header: 'Encashed', className: 'tnum', hideOnMobile: true }, { key: 'lapsed', header: 'Lapsed', className: 'tnum', hideOnMobile: true },
        { key: 'balance', header: 'Balance', className: 'tnum font-semibold', value: (r) => Number(r.balance) },
      ]} toolbar={<Select value={yr} onChange={(e) => setYr(Number(e.target.value))} className="w-auto" aria-label="Leave year">{[year + 1, year, year - 1, year - 2].map((y) => <option key={y} value={y}>{y}</option>)}</Select>} />
      {adj && <AdjustDialog onClose={() => setAdj(false)} yr={yr} />}
    </div>
  )
}

function AdjustDialog({ onClose, yr }: { onClose: () => void; yr: number }) {
  const [emp, setEmp] = useState<string | null>(null); const [type, setType] = useState(''); const [days, setDays] = useState(''); const [remarks, setRemarks] = useState('')
  const types = useLookup('leave_types')
  const save = useAction(() => rpc('adjust_leave_balance', { p_employee: emp, p_type: type, p_year: yr, p_days: Number(days), p_remarks: remarks }), { success: 'Balance adjusted', invalidate: [['leave']], onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Adjust balance (${yr})`} description="Use a negative number to deduct." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!emp || !type || !days || !remarks.trim()} onClick={() => save.mutate()}>Post adjustment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
        <Field label="Leave type" required><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Select…</option>{(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Days (+/−)" required><Input type="number" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Remarks" required className="sm:col-span-2"><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

export function LeaveAccrualPage() {
  const { orgId } = useMe()
  const q = useQuery({ queryKey: ['leave', 'ledger'], queryFn: () => unwrap<any[]>(db.from('leave_transactions').select('*, employees(first_name, last_name, employee_code), leave_types(name)').order('created_at', { ascending: false }).limit(1000)) })
  const run = useAction(() => rpc<number>('run_leave_accrual', { p_org: orgId, p_as_of: isoDate() }), { success: (n) => (n ? `${n} accrual entries posted` : 'Already accrued for this month — nothing new to post'), invalidate: [['leave']] })
  const close = useAction(() => rpc<number>('close_leave_year', { p_org: orgId, p_year: year - 1 }), { success: (n) => `${n} balances closed for ${year - 1}`, invalidate: [['leave']] })
  const confirm = useConfirm()
  return (
    <div>
      <PageHeader title="Leave accrual" description="Accrual runs automatically on the 1st of each month (scheduled job) and is safe to run again — each employee is credited once per period."
        actions={<>
          <Button variant="secondary" onClick={async () => { if ((await confirm({ title: `Close leave year ${year - 1}?`, description: 'Carries forward up to each policy’s limit and lapses the rest.' })).ok) close.mutate() }}>Close {year - 1}</Button>
          <Button loading={run.isPending} onClick={() => run.mutate()}><Play /> Run accrual now</Button>
        </>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Leave ledger" columns={[
        { key: 'created_at', header: 'Posted', cell: (r) => fmtDate(r.created_at, 'dd MMM yyyy HH:mm') }, { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` },
        { key: 'lt', header: 'Type', value: (r) => r.leave_types?.name }, { key: 'leave_year', header: 'Year' },
        { key: 'txn_type', header: 'Entry', cell: (r) => <Badge tone={['debit', 'encash', 'lapse'].includes(r.txn_type) ? 'warning' : 'success'}>{titleCase(r.txn_type)}</Badge>, value: (r) => r.txn_type },
        { key: 'days', header: 'Days', className: 'tnum' }, { key: 'remarks', header: 'Remarks', hideOnMobile: true },
      ]} />
    </div>
  )
}

export function LeaveEncashmentPage() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['leave', 'encash'], queryFn: () => unwrap<any[]>(db.from('leave_encashments').select('*, employees(first_name, last_name), leave_types(name)').order('created_at', { ascending: false })) })
  const types = useLookup<any>('leave_policies', 'leave_type_id, encash_max_days, leave_types(name)', 'leave_type_id', (x) => x.eq('encashable', true).eq('is_active', true))
  const [open, setOpen] = useState(false); const [type, setType] = useState(''); const [days, setDays] = useState('')
  const req = useAction(() => rpc('request_leave_encashment', { p_type: type, p_days: Number(days) }), { success: 'Encashment requested', invalidate: [['leave']], onSuccess: () => setOpen(false) })
  return (
    <div>
      <PageHeader title="Leave encashment" description="Encash eligible leave. On approval the days are debited and the amount (basic ÷ 30 × days) is added to the next payroll as a one-time earning."
        actions={can('leave.apply') && <Button onClick={() => setOpen(true)}><Coins /> Request encashment</Button>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Leave encashments" columns={[
        { key: 'created_at', header: 'Requested', cell: (r) => fmtDate(r.created_at) }, { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` },
        { key: 'lt', header: 'Leave type', value: (r) => r.leave_types?.name }, { key: 'days', header: 'Days', className: 'tnum' }, { key: 'amount', header: 'Amount', cell: (r) => money(r.amount) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <Dialog open={open} onOpenChange={setOpen} title="Request leave encashment" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={req.isPending} disabled={!type || !days} onClick={() => req.mutate()}>Submit</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Leave type" required><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Select…</option>{(types.data ?? []).map((t) => <option key={t.leave_type_id} value={t.leave_type_id}>{t.leave_types?.name} (max {t.encash_max_days})</option>)}</Select></Field>
          <Field label="Days" required><Input type="number" step="0.5" min="0.5" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function LeaveCalendarPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const from = isoDate(month), to = isoDate(endOfMonth(month))
  const reg = useLeaveRegister((q) => q.in('status', ['approved', 'pending']).lte('start_date', to).gte('end_date', from), `cal-${from}`)
  const hol = useQuery({ queryKey: ['holidays', from, 'leave'], queryFn: () => unwrap<any[]>(db.from('holidays').select('holiday_date, name').gte('holiday_date', from).lte('holiday_date', to)) })
  return (
    <div>
      <PageHeader title="Leave calendar" description="Approved (solid) and pending (outlined) leave for everyone you can see." actions={<MonthNav month={month} onChange={setMonth} />} />
      <MonthCalendar month={month} renderDay={(d) => {
        const items = (reg.data ?? []).filter((l) => isWithinInterval(d, { start: parseISO(l.start_date), end: parseISO(l.end_date) }))
        const h = (hol.data ?? []).find((x) => x.holiday_date === isoDate(d))
        return (
          <div className="space-y-0.5">
            {h && <div className="truncate rounded bg-info-soft px-1 text-[11px] text-info">{h.name}</div>}
            {items.slice(0, 3).map((l) => <div key={l.id} title={`${l.employee_name} · ${l.leave_type_name} (${l.status})`} className={cn('truncate rounded px-1 text-[11px]', l.status === 'pending' ? 'border border-dashed' : 'text-white')} style={l.status === 'pending' ? { borderColor: l.color, color: l.color } : { background: l.color }}>{l.employee_name.split(' ')[0]}</div>)}
            {items.length > 3 && <div className="text-[11px] text-muted">+{items.length - 3} more</div>}
          </div>
        )
      }} />
    </div>
  )
}

export const LeaveHolidaysPage = () => <CrudPage cfg={{ ...holidaysCfg, title: 'Holiday management' }} />
