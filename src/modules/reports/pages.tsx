import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { startOfMonth } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileSpreadsheet, FileText, Save, Trash2, BarChart3 } from 'lucide-react'
import { db, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/export'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip, EmptyState } from '@/components/common/page'
import { StatusBadge } from '@/components/common/status'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Card, CardHeader, Badge } from '@/components/ui/misc'
import { cn, fmtDate, fmtTime, isoDate, minutes, money, titleCase } from '@/lib/utils'

type Col = { key: string; header: string; kind?: 'date' | 'money' | 'minutes' | 'time' | 'status' | 'number' | 'bool' }
type Dataset = { view: string; label: string; dateField?: string; statusField?: string; statuses?: string[]; columns: Col[]; perm?: string; summary?: (rows: any[]) => { label: string; value: any; tone?: any }[]; chart?: { by: string; value?: string; label: string } }

export const DATASETS: Record<string, Dataset> = {
  employees: { view: 'v_employee_register', label: 'Employee register', dateField: 'date_of_joining', statusField: 'status', statuses: ['onboarding', 'probation', 'active', 'notice', 'exited', 'inactive'],
    columns: [{ key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'designation_name', header: 'Designation' }, { key: 'location_name', header: 'Location' },
      { key: 'manager_name', header: 'Manager' }, { key: 'employment_type', header: 'Type' }, { key: 'gender', header: 'Gender' }, { key: 'date_of_joining', header: 'Joined', kind: 'date' }, { key: 'exit_date', header: 'Exit', kind: 'date' }, { key: 'status', header: 'Status', kind: 'status' }],
    summary: (r) => [{ label: 'Employees', value: r.length }, { label: 'Active', value: r.filter((x) => ['active', 'probation', 'notice'].includes(x.status)).length, tone: 'success' }, { label: 'Exited', value: r.filter((x) => x.status === 'exited').length }],
    chart: { by: 'department_name', label: 'Headcount by department' } },
  attendance: { view: 'v_attendance_register', label: 'Attendance register', dateField: 'work_date', statusField: 'status', statuses: ['present', 'half_day', 'incomplete', 'absent', 'on_leave', 'holiday', 'weekly_off'],
    columns: [{ key: 'work_date', header: 'Date', kind: 'date' }, { key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'shift_name', header: 'Shift' },
      { key: 'first_in', header: 'In', kind: 'time' }, { key: 'last_out', header: 'Out', kind: 'time' }, { key: 'worked_minutes', header: 'Worked', kind: 'minutes' }, { key: 'late_minutes', header: 'Late (min)', kind: 'number' },
      { key: 'early_minutes', header: 'Early (min)', kind: 'number' }, { key: 'overtime_minutes', header: 'Overtime', kind: 'minutes' }, { key: 'status', header: 'Status', kind: 'status' }, { key: 'missing_checkout', header: 'No check-out', kind: 'bool' }, { key: 'site_name', header: 'Site' }],
    summary: (r) => [{ label: 'Records', value: r.length }, { label: 'Present', value: r.filter((x) => x.first_in).length, tone: 'success' }, { label: 'Late', value: r.filter((x) => x.is_late).length, tone: 'warning' },
      { label: 'Absent', value: r.filter((x) => x.status === 'absent').length, tone: 'danger' }, { label: 'Missing check-outs', value: r.filter((x) => x.missing_checkout).length, tone: 'danger' }, { label: 'Overtime', value: minutes(r.reduce((a, x) => a + x.overtime_minutes, 0)) }],
    chart: { by: 'status', label: 'Records by status' } },
  late: { view: 'v_attendance_register', label: 'Late arrival report', dateField: 'work_date', columns: [], },
  missing: { view: 'v_attendance_register', label: 'Missing check-out report', dateField: 'work_date', columns: [] },
  overtime: { view: 'v_attendance_register', label: 'Overtime report', dateField: 'work_date', columns: [] },
  leave: { view: 'v_leave_register', label: 'Leave utilisation', dateField: 'start_date', statusField: 'status', statuses: ['pending', 'approved', 'rejected', 'cancelled'],
    columns: [{ key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'leave_type_name', header: 'Leave type' },
      { key: 'start_date', header: 'From', kind: 'date' }, { key: 'end_date', header: 'To', kind: 'date' }, { key: 'days', header: 'Days', kind: 'number' }, { key: 'is_paid', header: 'Paid', kind: 'bool' }, { key: 'status', header: 'Status', kind: 'status' }, { key: 'reason', header: 'Reason' }],
    summary: (r) => [{ label: 'Applications', value: r.length }, { label: 'Approved days', value: r.filter((x) => x.status === 'approved').reduce((a, x) => a + Number(x.days), 0), tone: 'primary' }, { label: 'Unpaid days', value: r.filter((x) => x.status === 'approved' && !x.is_paid).reduce((a, x) => a + Number(x.days), 0), tone: 'danger' }],
    chart: { by: 'leave_type_name', value: 'days', label: 'Days by leave type' } },
  leave_balances: { view: 'v_leave_balances', label: 'Leave balances', columns: [{ key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'leave_type_name', header: 'Type' }, { key: 'leave_year', header: 'Year' },
    { key: 'opening', header: 'Opening', kind: 'number' }, { key: 'accrued', header: 'Accrued', kind: 'number' }, { key: 'used', header: 'Used', kind: 'number' }, { key: 'balance', header: 'Balance', kind: 'number' }] },
  payroll: { view: 'v_payroll_register', label: 'Payroll summary / salary statement', dateField: 'period_month', perm: 'payroll.view',
    columns: [{ key: 'period_month', header: 'Month', kind: 'date' }, { key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'payable_days', header: 'Paid days', kind: 'number' }, { key: 'lop_days', header: 'LOP', kind: 'number' },
      { key: 'basic', header: 'Basic', kind: 'money' }, { key: 'gross_earnings', header: 'Gross', kind: 'money' }, { key: 'pf', header: 'PF', kind: 'money' }, { key: 'esi', header: 'ESI', kind: 'money' }, { key: 'pt', header: 'PT', kind: 'money' },
      { key: 'total_deductions', header: 'Deductions', kind: 'money' }, { key: 'net_pay', header: 'Net', kind: 'money' }, { key: 'employer_contributions', header: 'Employer contrib.', kind: 'money' }, { key: 'run_status', header: 'Run', kind: 'status' }],
    summary: (r) => [{ label: 'Entries', value: r.length }, { label: 'Gross', value: money(r.reduce((a, x) => a + Number(x.gross_earnings), 0)) }, { label: 'Deductions', value: money(r.reduce((a, x) => a + Number(x.total_deductions), 0)) }, { label: 'Net', value: money(r.reduce((a, x) => a + Number(x.net_pay), 0)), tone: 'success' }],
    chart: { by: 'department_name', value: 'net_pay', label: 'Net pay by department' } },
  claims: { view: 'v_claims_register', label: 'Claims & reimbursements', dateField: 'expense_date', statusField: 'status', statuses: ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'],
    columns: [{ key: 'claim_number', header: 'Claim' }, { key: 'employee_name', header: 'Employee' }, { key: 'department_name', header: 'Department' }, { key: 'category_name', header: 'Category' }, { key: 'expense_date', header: 'Date', kind: 'date' },
      { key: 'amount', header: 'Amount', kind: 'money' }, { key: 'approved_amount', header: 'Approved', kind: 'money' }, { key: 'status', header: 'Status', kind: 'status' }, { key: 'batch_reference', header: 'Payment ref' }, { key: 'paid_on', header: 'Paid on', kind: 'date' }],
    summary: (r) => [{ label: 'Claims', value: r.length }, { label: 'Claimed', value: money(r.reduce((a, x) => a + Number(x.amount), 0)) }, { label: 'Reimbursed', value: money(r.filter((x) => x.status === 'reimbursed').reduce((a, x) => a + Number(x.approved_amount ?? x.amount), 0)), tone: 'success' }],
    chart: { by: 'category_name', value: 'amount', label: 'Amount by category' } },
  performance: { view: 'v_appraisal_register', label: 'Appraisal summary', statusField: 'status', statuses: ['pending', 'submitted'],
    columns: [{ key: 'cycle_name', header: 'Cycle' }, { key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'stage', header: 'Stage' }, { key: 'weighted_score', header: 'Score', kind: 'number' }, { key: 'overall_rating', header: 'Rating', kind: 'number' }, { key: 'status', header: 'Status', kind: 'status' }, { key: 'submitted_at', header: 'Submitted', kind: 'date' }],
    chart: { by: 'overall_rating', label: 'Reviews by rating' } },
  training: { view: 'v_training_register', label: 'Training completion', dateField: 'enrolled_at', statusField: 'status', statuses: ['enrolled', 'in_progress', 'completed', 'failed', 'withdrawn'],
    columns: [{ key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'department_name', header: 'Department' }, { key: 'course_title', header: 'Course' }, { key: 'is_mandatory', header: 'Mandatory', kind: 'bool' },
      { key: 'progress', header: 'Progress %', kind: 'number' }, { key: 'due_date', header: 'Due', kind: 'date' }, { key: 'completed_at', header: 'Completed', kind: 'date' }, { key: 'status', header: 'Status', kind: 'status' }, { key: 'certificate_number', header: 'Certificate' }],
    summary: (r) => [{ label: 'Enrolments', value: r.length }, { label: 'Completed', value: r.filter((x) => x.status === 'completed').length, tone: 'success' }, { label: 'Overdue', value: r.filter((x) => x.due_date && x.due_date < isoDate() && x.status !== 'completed').length, tone: 'danger' }],
    chart: { by: 'course_title', label: 'Enrolments by course' } },
  field: { view: 'v_field_visits', label: 'Field workforce activity', dateField: 'check_in_at',
    columns: [{ key: 'check_in_at', header: 'Started', kind: 'date' }, { key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'site_name', header: 'Site' }, { key: 'client_name', header: 'Customer' }, { key: 'purpose', header: 'Purpose' }, { key: 'duration_minutes', header: 'Duration', kind: 'minutes' }, { key: 'outcome', header: 'Outcome' }],
    summary: (r) => [{ label: 'Visits', value: r.length }, { label: 'Time on site', value: minutes(r.reduce((a, x) => a + Number(x.duration_minutes), 0)) }, { label: 'People', value: new Set(r.map((x) => x.employee_id)).size }],
    chart: { by: 'employee_name', label: 'Visits by employee' } },
  onboarding: { view: 'v_lifecycle_register', label: 'Onboarding report', dateField: 'key_date', columns: [{ key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'key_date', header: 'Joining', kind: 'date' }, { key: 'done_tasks', header: 'Tasks done', kind: 'number' }, { key: 'total_tasks', header: 'Tasks', kind: 'number' }, { key: 'status', header: 'Status', kind: 'status' }] },
  offboarding: { view: 'v_lifecycle_register', label: 'Offboarding report', dateField: 'key_date', columns: [{ key: 'employee_code', header: 'ID' }, { key: 'employee_name', header: 'Name' }, { key: 'reason', header: 'Separation' }, { key: 'key_date', header: 'Last day', kind: 'date' }, { key: 'done_tasks', header: 'Tasks done', kind: 'number' }, { key: 'total_tasks', header: 'Tasks', kind: 'number' }, { key: 'status', header: 'Status', kind: 'status' }] },
  departments: { view: 'v_employee_register', label: 'Department distribution', columns: [] },
}
// derived reports share their parent's columns
DATASETS.late = { ...DATASETS.attendance, label: 'Late arrival report', statusField: undefined, chart: { by: 'employee_name', label: 'Late arrivals by employee' } }
DATASETS.missing = { ...DATASETS.attendance, label: 'Missing check-out report', statusField: undefined, chart: { by: 'employee_name', label: 'Missing check-outs by employee' } }
DATASETS.overtime = { ...DATASETS.attendance, label: 'Overtime report', statusField: undefined, chart: { by: 'employee_name', value: 'overtime_minutes', label: 'Overtime minutes by employee' } }
DATASETS.departments = { ...DATASETS.employees, label: 'Department distribution', chart: { by: 'department_name', label: 'Employees by department' } }

const EXTRA: Record<string, (q: any) => any> = {
  late: (q) => q.eq('is_late', true), missing: (q) => q.eq('missing_checkout', true), overtime: (q) => q.gt('overtime_minutes', 0),
  onboarding: (q) => q.eq('kind', 'onboarding'), offboarding: (q) => q.eq('kind', 'offboarding'),
}

const fmt = (c: Col, v: any) => {
  if (v === null || v === undefined || v === '') return ''
  switch (c.kind) { case 'date': return fmtDate(v); case 'money': return money(v); case 'minutes': return minutes(v); case 'time': return fmtTime(v); case 'bool': return v ? 'Yes' : 'No'; case 'status': return titleCase(v); default: return v }
}

export function ReportView({ reportKey: rk, columnsOverride, title }: { reportKey?: string; columnsOverride?: string[]; title?: string }) {
  const params = useParams()
  const key = rk ?? params.report ?? 'employees'
  const ds = DATASETS[key]
  const { can } = useAuth()
  const [from, setFrom] = useState(isoDate(startOfMonth(new Date(new Date().getFullYear(), 0, 1))))
  const [to, setTo] = useState(isoDate())
  const [dept, setDept] = useState(''), [desig, setDesig] = useState(''), [status, setStatus] = useState('')
  const depts = useLookup('departments'), desigs = useLookup('designations')
  const q = useQuery({
    queryKey: ['report', key, from, to, dept, desig, status],
    enabled: !!ds && (!ds.perm || can(ds.perm)),
    queryFn: async () => {
      let x: any = db.from(ds.view).select('*').limit(10000)
      if (ds.dateField) x = x.gte(ds.dateField, from).lte(ds.dateField, ds.dateField.endsWith('_at') ? `${to}T23:59:59` : to)
      if (dept) x = x.eq('department_id', dept)
      if (desig) x = x.eq('designation_id', desig)
      if (status && ds.statusField) x = x.eq(ds.statusField, status)
      if (EXTRA[key]) x = EXTRA[key](x)
      return unwrap<any[]>(x)
    },
  })
  if (!ds) return <EmptyState title="Unknown report" />
  if (ds.perm && !can(ds.perm)) return <EmptyState title="You do not have access to this report" />
  const cols = columnsOverride ? ds.columns.filter((c) => columnsOverride.includes(c.key)) : ds.columns
  const rows = q.data ?? []
  const chart = ds.chart ? Object.entries(rows.reduce((m: Record<string, number>, r) => { const k = String(r[ds.chart!.by] ?? '—'); m[k] = (m[k] ?? 0) + (ds.chart!.value ? Number(r[ds.chart!.value] ?? 0) : 1); return m }, {})).map(([name, value]) => ({ name: ds.chart!.by === 'status' ? titleCase(name) : name, value })).sort((a, b) => b.value - a.value).slice(0, 15) : []
  const tableCols: Column<any>[] = cols.map((c) => ({ key: c.key, header: c.header, value: (r: any) => (c.kind === 'money' || c.kind === 'number' || c.kind === 'minutes' ? Number(r[c.key] ?? 0) : fmt(c, r[c.key])), cell: (r: any) => (c.kind === 'status' ? <StatusBadge status={r[c.key]} /> : fmt(c, r[c.key])), className: ['money', 'number', 'minutes'].includes(c.kind ?? '') ? 'tnum' : undefined }))
  const exportCols: ExportColumn[] = cols.map((c) => ({ key: c.key, header: c.header, format: (r: any) => fmt(c, r[c.key]) }))
  const subtitle = `${ds.dateField ? `${fmtDate(from)} – ${fmtDate(to)}` : 'All dates'}${dept ? ` · ${depts.data?.find((d) => d.id === dept)?.name}` : ''}${status ? ` · ${titleCase(status)}` : ''}`
  return (
    <div className="space-y-5">
      <PageHeader title={title ?? ds.label} description={subtitle} crumbs={[{ label: 'Reports & Analytics', to: '/reports/employees' }]}
        actions={can('reports.export') && <>
          <Button variant="secondary" disabled={!rows.length} onClick={() => exportExcel(ds.label, exportCols, rows)}><FileSpreadsheet /> Excel</Button>
          <Button variant="secondary" disabled={!rows.length} onClick={() => exportPdf(ds.label, exportCols, rows, subtitle)}><FileText /> PDF</Button>
        </>} />
      <Card className="flex flex-wrap items-end gap-3 p-4">
        {ds.dateField && <><Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
        <Field label="Department"><Select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Designation"><Select value={desig} onChange={(e) => setDesig(e.target.value)}><option value="">All</option>{(desigs.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        {ds.statusField && <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{ds.statuses!.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>}
      </Card>
      {ds.summary && rows.length > 0 && <StatStrip items={ds.summary(rows)} />}
      {chart.length > 0 && <ChartCard title={ds.chart!.label} height={260}><ResponsiveContainer><BarChart data={chart}><CartesianGrid {...GRID} /><XAxis dataKey="name" {...AXIS} interval={0} angle={chart.length > 6 ? -20 : 0} textAnchor={chart.length > 6 ? 'end' : 'middle'} height={chart.length > 6 ? 60 : 30} /><YAxis {...AXIS} width={50} /><Tooltip {...TOOLTIP} /><Bar dataKey="value" fill={SERIES[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>}
      <DataTable rows={rows} columns={tableCols} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} exportName={ds.label} pageSize={50} dense emptyTitle="No records match these filters" />
    </div>
  )
}

export function CustomReports() {
  const { orgId, userId } = useMe()
  const [ds, setDs] = useState('employees')
  const [sel, setSel] = useState<string[]>(DATASETS.employees.columns.slice(0, 6).map((c) => c.key))
  const [name, setName] = useState('')
  const saved = useQuery({ queryKey: ['reports', 'saved'], queryFn: () => unwrap<any[]>(db.from('saved_reports').select('*').order('created_at', { ascending: false })) })
  const save = useAction(() => unwrap(db.from('saved_reports').insert({ organisation_id: orgId, owner_id: userId, name, dataset: ds, config: { columns: sel } }).select('id')), { success: 'Report saved', invalidate: [['reports', 'saved']], onSuccess: () => setName('') })
  const del = useAction((id: string) => unwrap(db.from('saved_reports').delete().eq('id', id).select('id')), { invalidate: [['reports', 'saved']] })
  const pick = (k: string) => { setDs(k); setSel(DATASETS[k].columns.slice(0, 6).map((c) => c.key)) }
  const base = ['employees', 'attendance', 'leave', 'leave_balances', 'payroll', 'claims', 'performance', 'training', 'field', 'onboarding', 'offboarding']
  return (
    <div className="space-y-5">
      <PageHeader title="Custom reports" description="Pick a dataset and the columns you need. Data respects your permissions. Save a layout to reuse it." />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <Field label="Dataset"><Select value={ds} onChange={(e) => pick(e.target.value)}>{base.map((k) => <option key={k} value={k}>{DATASETS[k].label}</option>)}</Select></Field>
            <div className="mt-4 text-[13px] font-medium">Columns</div>
            <div className="mt-2 space-y-1">{DATASETS[ds].columns.map((c) => <label key={c.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(c.key)} onChange={(e) => setSel(e.target.checked ? [...sel, c.key] : sel.filter((x) => x !== c.key))} />{c.header}</label>)}</div>
            <div className="mt-4 flex gap-2"><Input placeholder="Save as…" value={name} onChange={(e) => setName(e.target.value)} /><Button disabled={!name || !sel.length} loading={save.isPending} onClick={() => save.mutate()}><Save /></Button></div>
          </Card>
          <Card><CardHeader title="Saved reports" />
            <ul className="divide-y divide-line">{(saved.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm"><button className="text-left text-primary hover:underline" onClick={() => { setDs(s.dataset); setSel(s.config.columns) }}>{s.name}</button><Button size="icon-sm" variant="ghost" aria-label="Delete saved report" onClick={() => del.mutate(s.id)}><Trash2 /></Button></li>
            ))}{(saved.data ?? []).length === 0 && <li className="px-4 py-4 text-sm text-muted">None yet</li>}</ul>
          </Card>
        </div>
        <ReportView key={ds + sel.join()} reportKey={ds} columnsOverride={sel} title={`Custom · ${DATASETS[ds].label}`} />
      </div>
    </div>
  )
}

export function ExportCentre() {
  const { can } = useAuth()
  const groups: [string, string[]][] = [['People', ['employees', 'departments', 'onboarding', 'offboarding']], ['Time', ['attendance', 'late', 'missing', 'overtime', 'leave', 'leave_balances']],
    ['Money', ['payroll', 'claims']], ['Growth', ['performance', 'training', 'field']]]
  return (
    <div>
      <PageHeader title="Export centre" description="Every report, with filters and Excel/PDF export. Exports contain only data you are allowed to see." />
      <div className="grid gap-5 md:grid-cols-2">
        {groups.map(([g, keys]) => (
          <Card key={g}><CardHeader title={g} />
            <ul className="divide-y divide-line">{keys.filter((k) => !DATASETS[k].perm || can(DATASETS[k].perm!)).map((k) => (
              <li key={k}><Link to={`/reports/view/${k}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-raised"><span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" />{DATASETS[k].label}</span><span className="text-xs text-muted">Open</span></Link></li>
            ))}</ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
