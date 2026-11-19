import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Calculator, Download, Lock, RotateCcw, Send, Plus, Trash2, FileText, Calculator as Calc } from 'lucide-react'
import { format, startOfMonth, subMonths } from 'date-fns'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth } from '@/app/auth'
import { useAction } from '@/hooks/data'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip, QueryView, EmptyState } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { CrudPage, LookupSelect, type CrudConfig } from '@/components/crud/CrudPage'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { fmtDate, fmtDateTime, money, titleCase, isoDate, moneyShort } from '@/lib/utils'
import { ApprovalsInbox } from '@/modules/approvals/Inbox'
import { downloadPayslip } from './payslip'

const useRuns = () => useQuery({ queryKey: ['payroll', 'runs'], queryFn: () => unwrap<any[]>(db.from('payroll_runs').select('*, payroll_periods(period_month, start_date, end_date)').order('created_at', { ascending: false })) })
const runMonth = (r: any) => fmtDate(r?.payroll_periods?.period_month, 'MMM yyyy')

export function PayrollDashboard() {
  const runs = useRuns()
  const latest = runs.data?.[0]
  const chart = [...(runs.data ?? [])].reverse().map((r) => ({ month: fmtDate(r.payroll_periods?.period_month, 'MMM yy'), Net: Number(r.total_net), Deductions: Number(r.total_deductions), 'Employer contributions': Number(r.total_employer_cost) - Number(r.total_gross) }))
  return (
    <div className="space-y-5">
      <PageHeader title="Payroll dashboard" description="Internal payroll — calculated from approved attendance, leave and salary structures." />
      <StatStrip items={[
        { label: 'Latest run', value: latest ? runMonth(latest) : '—', hint: latest ? <StatusBadge status={latest.status} /> : undefined, to: '/payroll/processing' },
        { label: 'Employees paid', value: latest?.employee_count ?? '—' },
        { label: 'Gross', value: money(latest?.total_gross) }, { label: 'Net pay', value: money(latest?.total_net), tone: 'success' },
        { label: 'Employer cost', value: money(latest?.total_employer_cost), hint: 'Gross + employer PF/ESI' },
      ]} />
      <ChartCard title="Payroll by month" height={300}>
        {chart.length === 0 ? <EmptyState title="No payroll runs yet" /> : (
          <ResponsiveContainer><BarChart data={chart}><CartesianGrid {...GRID} /><XAxis dataKey="month" {...AXIS} /><YAxis {...AXIS} width={70} tickFormatter={moneyShort} /><Tooltip {...TOOLTIP} formatter={(v: any) => money(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Net" stackId="a" fill={SERIES[1]} /><Bar dataKey="Deductions" stackId="a" fill={SERIES[2]} /><Bar dataKey="Employer contributions" stackId="a" fill={SERIES[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        )}
      </ChartCard>
      <RunsTable />
    </div>
  )
}

function RunsTable({ onOpen }: { onOpen?: (r: any) => void }) {
  const runs = useRuns()
  return <DataTable rows={runs.data} loading={runs.isLoading} error={runs.error} onRowClick={onOpen} searchable={false} exportName="Payroll runs" columns={[
    { key: 'month', header: 'Month', value: (r) => r.payroll_periods?.period_month, cell: (r) => <span className="font-medium">{runMonth(r)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.reopened_count > 0 && <Badge tone="warning">Reopened ×{r.reopened_count}</Badge>}</div> },
    { key: 'employee_count', header: 'Employees', className: 'tnum' }, { key: 'total_gross', header: 'Gross', cell: (r) => money(r.total_gross) },
    { key: 'total_deductions', header: 'Deductions', cell: (r) => money(r.total_deductions) }, { key: 'total_net', header: 'Net', cell: (r) => <span className="font-medium">{money(r.total_net)}</span> },
    { key: 'calculated_at', header: 'Calculated', cell: (r) => fmtDateTime(r.calculated_at), hideOnMobile: true }, { key: 'locked_at', header: 'Locked', cell: (r) => fmtDateTime(r.locked_at), hideOnMobile: true },
  ]} emptyTitle="No payroll runs yet" />
}

function EntryDrawer({ entry, onClose }: { entry: any; onClose: () => void }) {
  const lines = useQuery({ queryKey: ['payroll', 'lines', entry.id], queryFn: () => unwrap<any[]>(db.from('payroll_entry_lines').select('*').eq('entry_id', entry.id).order('display_order')) })
  const sec = (t: string, type: string) => {
    const ls = (lines.data ?? []).filter((l) => l.line_type === type)
    if (!ls.length) return null
    return (
      <div className="mb-5"><h4 className="mb-2 text-sm font-semibold">{t}</h4>
        <ul className="divide-y divide-line rounded-lg border border-line">{ls.map((l) => <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm"><span><span>{l.component_name}</span>{l.basis && <span className="block text-xs text-muted">{l.basis}</span>}</span><span className="tnum">{money(l.amount, true)}</span></li>)}</ul>
      </div>
    )
  }
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={entry.employee_name} description={`${entry.employee_code} · ${entry.payable_days}/${entry.days_in_period} paid days · ${entry.lop_days} LOP`}>
      <StatStrip className="mb-5 !grid-cols-3 lg:!grid-cols-3" items={[{ label: 'Gross', value: money(entry.gross_earnings) }, { label: 'Deductions', value: money(entry.total_deductions) }, { label: 'Net', value: money(entry.net_pay), tone: 'success' }]} />
      {entry.has_error && <div className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{entry.remarks}</div>}
      {sec('Earnings', 'earning')}{sec('Deductions', 'deduction')}{sec('Employer contributions', 'employer_contribution')}
    </Drawer>
  )
}

function RunEntries({ run }: { run: any }) {
  const q = useQuery({ queryKey: ['payroll', 'entries', run.id, run.status], queryFn: () => unwrap<any[]>(db.from('v_payroll_register').select('*').eq('run_id', run.id).order('employee_name')) })
  const [open, setOpen] = useState<any | null>(null)
  return (
    <>
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={setOpen} exportName={`Payroll register ${runMonth(run)}`} columns={[
        { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} sub={`${r.employee_code} · ${r.department_name ?? '—'}`} /> },
        { key: 'payable_days', header: 'Paid days', value: (r) => Number(r.payable_days), cell: (r) => <span className="tnum">{r.payable_days}/{r.days_in_period}{Number(r.lop_days) > 0 && <span className="ml-1 text-danger">−{r.lop_days}</span>}</span> },
        { key: 'monthly_gross', header: 'Monthly gross', value: (r) => Number(r.monthly_gross), cell: (r) => money(r.monthly_gross), hideOnMobile: true },
        { key: 'gross_earnings', header: 'Earned', value: (r) => Number(r.gross_earnings), cell: (r) => money(r.gross_earnings) },
        { key: 'pf', header: 'PF', value: (r) => Number(r.pf), cell: (r) => money(r.pf), hideOnMobile: true }, { key: 'esi', header: 'ESI', value: (r) => Number(r.esi), cell: (r) => money(r.esi), hideOnMobile: true },
        { key: 'pt', header: 'PT', value: (r) => Number(r.pt), cell: (r) => money(r.pt), hideOnMobile: true },
        { key: 'total_deductions', header: 'Deductions', value: (r) => Number(r.total_deductions), cell: (r) => money(r.total_deductions) },
        { key: 'net_pay', header: 'Net pay', value: (r) => Number(r.net_pay), cell: (r) => <span className="font-semibold">{money(r.net_pay)}</span> },
        { key: 'has_error', header: '', value: (r) => (r.has_error ? 'Error' : ''), cell: (r) => (r.has_error ? <Badge tone="danger">Check</Badge> : null) },
      ]} emptyTitle="Not calculated yet" emptyDescription="Run the calculation to see each employee's pay." />
      {open && <EntryDrawer entry={open} onClose={() => setOpen(null)} />}
    </>
  )
}

export function PayrollProcessing({ reviewOnly }: { reviewOnly?: boolean }) {
  const { can } = useAuth()
  const confirm = useConfirm()
  const runs = useRuns()
  const [month, setMonth] = useState(format(startOfMonth(subMonths(new Date(), new Date().getDate() < 20 ? 1 : 0)), 'yyyy-MM'))
  const [selected, setSelected] = useState<string | null>(null)
  const run = (runs.data ?? []).find((r) => r.id === selected) ?? runs.data?.[0]
  const inv = [['payroll']]
  const create = useAction(() => rpc<string>('create_payroll_run', { p_month: `${month}-01` }), { success: 'Payroll run ready', invalidate: inv, onSuccess: (id) => setSelected(id) })
  const calc = useAction((id: string) => rpc<any>('calculate_payroll_run', { p_run: id }), { success: (r) => `Calculated ${r.employees} employees`, invalidate: inv })
  const submit = useAction((id: string) => rpc('submit_payroll_run', { p_run: id }), { success: 'Submitted for approval', invalidate: inv })
  const lock = useAction((id: string) => rpc<number>('lock_payroll_run', { p_run: id }), { success: (n) => `Locked — ${n} payslips published`, invalidate: inv })
  const reopen = useAction(({ id, reason }: { id: string; reason: string }) => rpc('reopen_payroll_run', { p_run: id, p_reason: reason }), { success: 'Run reopened (audited)', invalidate: inv })
  const steps = ['draft', 'calculated', 'submitted', 'approved', 'locked']
  const idx = run ? steps.indexOf(run.status === 'rejected' ? 'calculated' : run.status) : -1
  return (
    <div className="space-y-5">
      <PageHeader title={reviewOnly ? 'Payroll review' : 'Payroll processing'} description={reviewOnly ? 'Inspect every employee’s calculation line by line before approval.' : 'Create the month’s run, calculate, submit for approval, then lock to publish payslips. Locked runs need an audited reopen to change.'}
        actions={!reviewOnly && can('payroll.process') && <><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto" aria-label="Payroll month" /><Button loading={create.isPending} onClick={() => create.mutate()}><Plus /> Open run</Button></>} />
      {(runs.data ?? []).length > 1 && (
        <div className="flex flex-wrap gap-2">{runs.data!.map((r) => <button key={r.id} onClick={() => setSelected(r.id)} className={`rounded-full border px-3 py-1 text-sm ${run?.id === r.id ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:bg-raised'}`}>{runMonth(r)}</button>)}</div>
      )}
      {!run ? <Card><EmptyState title="No payroll run yet" description="Choose a month and open a run to begin." /></Card> : (
        <>
          <Card className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm text-muted">{fmtDate(run.payroll_periods?.start_date)} – {fmtDate(run.payroll_periods?.end_date)}</div>
                <div className="text-xl font-semibold">{runMonth(run)}</div>
              </div>
              <ol className="flex flex-wrap items-center gap-2 text-xs">
                {steps.map((s, i) => <li key={s} className="flex items-center gap-2"><span className={`flex h-6 items-center rounded-full px-2.5 ${i < idx ? 'bg-success-soft text-success' : i === idx ? 'bg-primary text-primary-fg' : 'bg-raised text-subtle'}`}>{titleCase(s)}</span>{i < steps.length - 1 && <span className="h-px w-4 bg-line" />}</li>)}
              </ol>
              {!reviewOnly && <div className="flex flex-wrap gap-2">
                {['draft', 'calculated', 'rejected'].includes(run.status) && can('payroll.process') && <Button variant="secondary" loading={calc.isPending} onClick={() => calc.mutate(run.id)}><Calculator /> {run.status === 'draft' ? 'Calculate' : 'Recalculate'}</Button>}
                {run.status === 'calculated' && can('payroll.process') && <Button loading={submit.isPending} onClick={() => submit.mutate(run.id)}><Send /> Submit for approval</Button>}
                {run.status === 'approved' && can('payroll.approve') && <Button variant="success" loading={lock.isPending} onClick={async () => { if ((await confirm({ title: `Lock ${runMonth(run)} payroll?`, description: 'Payslips are published to employees. Changes afterwards need an audited reopen.' })).ok) lock.mutate(run.id) }}><Lock /> Lock & publish</Button>}
                {['approved', 'locked', 'submitted'].includes(run.status) && can('payroll.manage') && <Button variant="ghost" onClick={async () => { const c = await confirm({ title: 'Reopen payroll run?', description: 'Payslips are withdrawn and loan recoveries reversed until it is locked again.', requireReason: true, danger: true, confirmLabel: 'Reopen' }); if (c.ok) reopen.mutate({ id: run.id, reason: c.reason! }) }}><RotateCcw /> Reopen</Button>}
              </div>}
            </div>
            {run.notes && <p className="mt-3 rounded-md bg-raised px-3 py-2 text-sm text-muted">{run.notes}</p>}
          </Card>
          <StatStrip items={[{ label: 'Employees', value: run.employee_count }, { label: 'Gross', value: money(run.total_gross) }, { label: 'Deductions', value: money(run.total_deductions) }, { label: 'Net pay', value: money(run.total_net), tone: 'success' }, { label: 'Employer cost', value: money(run.total_employer_cost) }]} />
          <RunEntries run={run} />
        </>
      )}
    </div>
  )
}

export function PayrollApproval() {
  return (
    <div className="space-y-6">
      <PageHeader title="Payroll approval" description="Payroll runs and salary revisions follow the approval workflow configured in Administration (default: HR review, then final approval)." />
      <ApprovalsInbox entityTypes={['payroll_run', 'salary_revision']} embedded />
      <Card><CardHeader title="All runs" /><div className="p-3"><RunsTable /></div></Card>
    </div>
  )
}

export function PayslipsPage({ mine }: { mine?: boolean }) {
  const [month, setMonth] = useState('')
  const q = useQuery({
    queryKey: ['payroll', 'payslips', mine, month],
    queryFn: async () => {
      let query = db.from('payslips').select('*, payroll_entries(gross_earnings, total_deductions, net_pay, lop_days), employees(first_name, last_name, employee_code)').order('period_month', { ascending: false }).limit(2000)
      if (month) query = query.eq('period_month', `${month}-01`)
      return unwrap<any[]>(query)
    },
  })
  const dl = useAction((id: string) => downloadPayslip(id), { invalidate: [['payroll', 'payslips']] })
  return (
    <div>
      {!mine && <PageHeader title="Payslips" description="Published when a payroll run is locked. Employees see only their own." />}
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Payslips" columns={[
        { key: 'period_month', header: 'Month', cell: (r) => <span className="font-medium">{fmtDate(r.period_month, 'MMMM yyyy')}</span> },
        ...(!mine ? [{ key: 'emp', header: 'Employee', value: (r: any) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r: any) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> } as Column<any>] : []),
        { key: 'payslip_number', header: 'Payslip no.', hideOnMobile: true },
        { key: 'gross', header: 'Gross', value: (r) => Number(r.payroll_entries?.gross_earnings), cell: (r) => money(r.payroll_entries?.gross_earnings) },
        { key: 'ded', header: 'Deductions', value: (r) => Number(r.payroll_entries?.total_deductions), cell: (r) => money(r.payroll_entries?.total_deductions), hideOnMobile: true },
        { key: 'net', header: 'Net pay', value: (r) => Number(r.payroll_entries?.net_pay), cell: (r) => <span className="font-semibold">{money(r.payroll_entries?.net_pay)}</span> },
        { key: 'viewed_at', header: 'Viewed', value: (r) => (r.viewed_at ? 'Yes' : 'No'), hideOnMobile: true },
        { key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => <Button size="sm" variant="secondary" onClick={() => dl.mutate(r.id)}><Download /> PDF</Button> },
      ]} toolbar={!mine && <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto" aria-label="Month" />} emptyTitle="No payslips yet" />
    </div>
  )
}

// ---------------- configuration ----------------
const componentCfg = (type: 'earning' | 'deduction'): CrudConfig => ({
  title: type === 'earning' ? 'Allowances' : 'Deductions',
  description: type === 'earning' ? 'Earning components. Percentages are of gross or of basic; "balancing" absorbs the remainder of gross (special allowance).' : 'Deduction components. Statutory deductions (PF, ESI, PT) are calculated from Statutory Components; others come from recurring deductions, loans or one-time adjustments.',
  table: 'salary_components', permission: 'payroll.manage', filter: (q) => (type === 'earning' ? q.eq('component_type', 'earning') : q.in('component_type', ['deduction', 'employer_contribution'])),
  orderBy: { column: 'display_order' }, remove: { column: 'is_active', value: false }, queryKey: ['crud', 'salary_components', type],
  defaults: () => ({ component_type: type }),
  columns: [
    { key: 'name', header: 'Component', cell: (r) => <span>{r.name} <span className="text-xs text-subtle">{r.code}</span>{!r.is_active && <Badge className="ml-1">Archived</Badge>}</span> },
    { key: 'component_type', header: 'Type', value: (r) => titleCase(r.component_type) }, { key: 'calc_type', header: 'Calculation', value: (r) => titleCase(r.calc_type) },
    { key: 'default_value', header: 'Default', value: (r) => (r.calc_type.startsWith('percent') ? `${r.default_value}%` : r.calc_type === 'fixed' ? money(r.default_value) : '—') },
    { key: 'statutory_code', header: 'Statutory', value: (r) => r.statutory_code ?? '' }, { key: 'prorate', header: 'Prorated', value: (r) => (r.prorate ? 'Yes' : 'No') },
  ],
  fields: [
    { name: 'code', label: 'Code', type: 'text', required: true, hint: 'BASIC is used for PF and HRA calculations' }, { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'component_type', label: 'Type', type: 'select', required: true, options: type === 'earning' ? [{ value: 'earning', label: 'Earning' }] : [{ value: 'deduction', label: 'Deduction' }, { value: 'employer_contribution', label: 'Employer contribution' }] },
    { name: 'calc_type', label: 'Calculation', type: 'select', required: true, default: 'fixed', options: (type === 'earning' ? ['fixed', 'percent_of_gross', 'percent_of_basic', 'balancing', 'variable'] : ['fixed', 'statutory', 'variable']).map((v) => ({ value: v, label: titleCase(v) })) },
    { name: 'default_value', label: 'Default value (amount or %)', type: 'number', default: 0, required: true },
    { name: 'statutory_code', label: 'Statutory code', type: 'select', options: ['PF', 'ESI', 'PT', 'LWF', 'TDS'].map((v) => ({ value: v, label: v })) },
    { name: 'display_order', label: 'Display order', type: 'number', default: 100, required: true },
    { name: 'prorate', label: 'Prorate by paid days', type: 'switch', default: true }, { name: 'is_taxable', label: 'Taxable', type: 'switch', default: true }, { name: 'is_active', label: 'Active', type: 'switch', default: true },
  ],
})
export const AllowancesPage = () => <CrudPage cfg={componentCfg('earning')} />
export const DeductionsPage = () => <CrudPage cfg={componentCfg('deduction')} />

export function StructuresPage() {
  const { can } = useAuth()
  const [sel, setSel] = useState<any | null>(null)
  return (
    <div className="space-y-5">
      <CrudPage cfg={{
        title: 'Salary structures', description: 'Templates of earning components. Employees are assigned a structure and a monthly gross; components are derived from it.',
        table: 'salary_structures', permission: 'payroll.manage', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
        columns: [{ key: 'name', header: 'Structure', cell: (r) => <span className="font-medium">{r.name}</span> }, { key: 'version', header: 'Version' }, { key: 'description', header: 'Description', hideOnMobile: true },
          { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) }, { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') }],
        rowActions: (r) => <Button size="sm" variant="ghost" onClick={() => setSel(r)}>Components</Button>,
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'version', label: 'Version', type: 'number', default: 1, required: true, min: 1 },
          { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
      }} />
      {sel && <StructureEditor structure={sel} writable={can('payroll.manage')} onClose={() => setSel(null)} />}
    </div>
  )
}

function StructureEditor({ structure, writable, onClose }: { structure: any; writable: boolean; onClose: () => void }) {
  const lines = useQuery({ queryKey: ['payroll', 'ssc', structure.id], queryFn: () => unwrap<any[]>(db.from('salary_structure_components').select('*, salary_components(code, name, calc_type, default_value)').eq('structure_id', structure.id)) })
  const comps = useQuery({ queryKey: ['payroll', 'comps-earn'], queryFn: () => unwrap<any[]>(db.from('salary_components').select('*').eq('component_type', 'earning').eq('is_active', true).order('display_order')) })
  const [comp, setComp] = useState(''); const [calc, setCalc] = useState(''); const [val, setVal] = useState('')
  const add = useAction(() => unwrap(db.from('salary_structure_components').insert({ structure_id: structure.id, component_id: comp, calc_type: calc || null, value: Number(val || 0) }).select('id')), { success: 'Component added', invalidate: [['payroll', 'ssc', structure.id]], onSuccess: () => { setComp(''); setVal(''); setCalc('') } })
  const del = useAction((id: string) => unwrap(db.from('salary_structure_components').delete().eq('id', id).select('id')), { invalidate: [['payroll', 'ssc', structure.id]] })
  const [gross, setGross] = useState(50000)
  const preview = useMemo(() => {
    const ls = (lines.data ?? []).map((l) => ({ code: l.salary_components.code, name: l.salary_components.name, calc: l.calc_type ?? l.salary_components.calc_type, val: Number(l.value) }))
    const out: { name: string; amount: number }[] = []; let basic = 0, sum = 0
    for (const p of [['percent_of_gross', 'fixed'], ['percent_of_basic'], ['balancing']]) for (const l of ls.filter((x) => p.includes(x.calc))) {
      const a = l.calc === 'fixed' ? l.val : l.calc === 'percent_of_gross' ? (gross * l.val) / 100 : l.calc === 'percent_of_basic' ? (basic * l.val) / 100 : Math.max(0, gross - sum)
      if (l.code === 'BASIC') basic += a; sum += a; out.push({ name: l.name, amount: a })
    }
    return out
  }, [lines.data, gross])
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={structure.name} description="Components and a live preview for a sample gross.">
      <DataTable rows={lines.data} loading={lines.isLoading} searchable={false} columns={[
        { key: 'name', header: 'Component', value: (r) => r.salary_components?.name }, { key: 'calc', header: 'Calculation', value: (r) => titleCase(r.calc_type ?? r.salary_components?.calc_type) },
        { key: 'value', header: 'Value', className: 'tnum' },
        ...(writable ? [{ key: '_a', header: '', sortable: false, exportable: false, cell: (r: any) => <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => del.mutate(r.id)}><Trash2 /></Button> } as Column<any>] : []),
      ]} emptyTitle="No components" />
      {writable && (
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_100px_auto]">
          <Select value={comp} onChange={(e) => setComp(e.target.value)}><option value="">Add component…</option>{(comps.data ?? []).filter((c) => !(lines.data ?? []).some((l) => l.component_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select value={calc} onChange={(e) => setCalc(e.target.value)}><option value="">Component default</option>{['fixed', 'percent_of_gross', 'percent_of_basic', 'balancing'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</Select>
          <Input type="number" placeholder="Value" value={val} onChange={(e) => setVal(e.target.value)} />
          <Button disabled={!comp} onClick={() => add.mutate()}><Plus /> Add</Button>
        </div>
      )}
      <Card className="mt-6"><CardHeader title="Preview" actions={<Input type="number" value={gross} onChange={(e) => setGross(Number(e.target.value))} className="w-32" aria-label="Sample gross" />} />
        <ul className="divide-y divide-line">{preview.map((p, i) => <li key={i} className="flex justify-between px-5 py-2 text-sm"><span>{p.name}</span><span className="tnum">{money(p.amount)}</span></li>)}
          <li className="flex justify-between px-5 py-2 text-sm font-semibold"><span>Total</span><span className="tnum">{money(preview.reduce((a, p) => a + p.amount, 0))}</span></li></ul>
      </Card>
    </Drawer>
  )
}

export const SalaryConfigPage = () => <CrudPage cfg={{
  title: 'Employee salary configuration', description: 'Effective-dated salary assignments. Use Salary Revision for approved changes; edit here only for corrections.',
  table: 'employee_salary_assignments', select: '*, employees(first_name, last_name, employee_code), salary_structures(name)', permission: 'payroll.manage', orgScoped: false,
  orderBy: { column: 'effective_from', ascending: false }, remove: 'delete',
  columns: [
    { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> },
    { key: 'structure', header: 'Structure', value: (r) => r.salary_structures?.name }, { key: 'monthly_gross', header: 'Monthly gross', value: (r) => Number(r.monthly_gross), cell: (r) => money(r.monthly_gross) },
    { key: 'annual_ctc', header: 'Annual CTC', value: (r) => Number(r.annual_ctc), cell: (r) => money(r.annual_ctc) }, { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) },
    { key: 'effective_to', header: 'To', cell: (r) => (r.effective_to ? fmtDate(r.effective_to) : <Badge tone="success">Current</Badge>) },
  ],
  fields: [
    { name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true }, { name: 'structure_id', label: 'Salary structure', type: 'lookup', lookup: { table: 'salary_structures', filter: (q) => q.eq('is_active', true) }, required: true },
    { name: 'monthly_gross', label: 'Monthly gross (₹)', type: 'number', min: 0, required: true }, { name: 'annual_ctc', label: 'Annual CTC (₹)', type: 'number', min: 0 },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'effective_to', label: 'Effective to', type: 'date' }, { name: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
}} />

export function StatutoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Statutory components" description="Effective-dated PF, ESI, gratuity and professional tax rules. Rates are data, never hard-coded — update them when the government notifies changes." />
      <Tabs defaultValue="rules">
        <TabsList><TabsTrigger value="rules">PF / ESI / Gratuity</TabsTrigger><TabsTrigger value="pt">Professional tax slabs</TabsTrigger><TabsTrigger value="recurring">Recurring deductions (TDS etc.)</TabsTrigger></TabsList>
        <TabsContent value="rules"><CrudPage cfg={{
          title: 'Statutory rules', embedded: true, table: 'statutory_configs', permission: 'payroll.manage', orderBy: { column: 'effective_from', ascending: false }, remove: { column: 'is_active', value: false },
          columns: [{ key: 'code', header: 'Rule', cell: (r) => <Badge tone="primary">{r.code}</Badge> }, { key: 'employee_rate', header: 'Employee rate / numerator', className: 'tnum' }, { key: 'employer_rate', header: 'Employer rate / divisor', className: 'tnum' },
            { key: 'wage_ceiling', header: 'Wage ceiling / cap', cell: (r) => (r.wage_ceiling ? money(r.wage_ceiling) : '—') }, { key: 'eligibility_threshold', header: 'Threshold', className: 'tnum' },
            { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) }, { key: 'effective_to', header: 'To', cell: (r) => fmtDate(r.effective_to) }, { key: 'notes', header: 'Notes', hideOnMobile: true }],
          fields: [{ name: 'code', label: 'Rule', type: 'select', required: true, options: ['PF', 'ESI', 'LWF', 'GRATUITY'].map((v) => ({ value: v, label: v })) },
            { name: 'employee_rate', label: 'Employee rate % (gratuity: days, e.g. 15)', type: 'number', required: true }, { name: 'employer_rate', label: 'Employer rate % (gratuity: divisor, e.g. 26)', type: 'number', required: true },
            { name: 'wage_ceiling', label: 'Wage ceiling (PF) / cap (gratuity)', type: 'number' }, { name: 'eligibility_threshold', label: 'Threshold (ESI gross limit / gratuity years)', type: 'number' },
            { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'effective_to', label: 'Effective to', type: 'date' }, { name: 'notes', label: 'Source / notes', type: 'textarea' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
        }} /></TabsContent>
        <TabsContent value="pt"><CrudPage cfg={{
          title: 'PT slabs', embedded: true, table: 'professional_tax_slabs', permission: 'payroll.manage', orderBy: { column: 'min_monthly_gross' }, remove: 'delete',
          columns: [{ key: 'state', header: 'State' }, { key: 'range', header: 'Monthly gross', value: (r) => `${money(r.min_monthly_gross)} – ${r.max_monthly_gross ? money(r.max_monthly_gross) : 'and above'}` },
            { key: 'monthly_amount', header: 'PT per month', cell: (r) => money(r.monthly_amount) }, { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) }, { key: 'notes', header: 'Notes', hideOnMobile: true }],
          fields: [{ name: 'state', label: 'State', type: 'text', required: true, default: 'Tamil Nadu' }, { name: 'min_monthly_gross', label: 'From (₹)', type: 'number', required: true }, { name: 'max_monthly_gross', label: 'To (₹, empty = no limit)', type: 'number' },
            { name: 'monthly_amount', label: 'PT per month (₹)', type: 'number', required: true }, { name: 'effective_from', label: 'Effective from', type: 'date', required: true }, { name: 'effective_to', label: 'Effective to', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
        }} /></TabsContent>
        <TabsContent value="recurring"><CrudPage cfg={{
          title: 'Recurring deductions', embedded: true, table: 'employee_recurring_deductions', select: '*, employees(first_name, last_name)', permission: 'payroll.manage', orgScoped: false, remove: { column: 'is_active', value: false },
          columns: [{ key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` }, { key: 'component_code', header: 'Code' }, { key: 'title', header: 'Title' },
            { key: 'monthly_amount', header: 'Per month', cell: (r) => money(r.monthly_amount) }, { key: 'start_month', header: 'From', cell: (r) => fmtDate(r.start_month, 'MMM yyyy') }, { key: 'end_month', header: 'To', cell: (r) => fmtDate(r.end_month, 'MMM yyyy') }],
          fields: [{ name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true }, { name: 'component_code', label: 'Code', type: 'text', required: true, default: 'TDS' },
            { name: 'title', label: 'Title', type: 'text', required: true, default: 'Income tax (TDS)' }, { name: 'monthly_amount', label: 'Monthly amount', type: 'number', required: true, min: 0 },
            { name: 'start_month', label: 'Start month (1st)', type: 'date', required: true }, { name: 'end_month', label: 'End month', type: 'date' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
        }} /><p className="mt-3 text-xs text-muted">Income-tax (TDS) is not computed automatically: finance enters the monthly TDS per employee after their regime/declaration review.</p></TabsContent>
      </Tabs>
    </div>
  )
}

export function SalaryRevisionsPage() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['payroll', 'revisions'], queryFn: () => unwrap<any[]>(db.from('salary_revisions').select('*, employees(first_name, last_name, employee_code)').order('created_at', { ascending: false })) })
  const [open, setOpen] = useState(false)
  const [emp, setEmp] = useState<string | null>(null); const [eff, setEff] = useState(isoDate(startOfMonth(new Date()))); const [gross, setGross] = useState(''); const [type, setType] = useState('increment'); const [reason, setReason] = useState(''); const [structure, setStructure] = useState<string | null>(null)
  const req = useAction(() => rpc('request_salary_revision', { p_employee: emp, p_effective: eff, p_new_gross: Number(gross), p_structure: structure, p_type: type, p_reason: reason }), { success: 'Revision submitted for approval', invalidate: [['payroll']], onSuccess: () => setOpen(false) })
  return (
    <div>
      <PageHeader title="Salary revisions" description="Increments and promotions go through approval; on approval a new effective-dated assignment is created and recorded in employee history."
        actions={can('payroll.manage') && <Button onClick={() => setOpen(true)}><Plus /> New revision</Button>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Salary revisions" columns={[
        { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> },
        { key: 'revision_type', header: 'Type', value: (r) => titleCase(r.revision_type) }, { key: 'current_gross', header: 'Current', cell: (r) => money(r.current_gross) },
        { key: 'new_gross', header: 'New', cell: (r) => <span className="font-medium">{money(r.new_gross)}</span> },
        { key: 'change', header: 'Change', value: (r) => (r.current_gross ? ((r.new_gross - r.current_gross) / r.current_gross) * 100 : null), cell: (r) => (r.current_gross ? <span className="text-success tnum">+{(((r.new_gross - r.current_gross) / r.current_gross) * 100).toFixed(1)}%</span> : '—') },
        { key: 'effective_from', header: 'Effective', cell: (r) => fmtDate(r.effective_from) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} />
      <Dialog open={open} onOpenChange={setOpen} title="New salary revision" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={req.isPending} disabled={!emp || !gross || !reason.trim()} onClick={() => req.mutate()}>Submit for approval</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{['increment', 'promotion', 'correction', 'market'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
          <Field label="Effective from" required><Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
          <Field label="New monthly gross (₹)" required><Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} /></Field>
          <Field label="Structure (optional)"><LookupSelect def={{ name: 's', label: 'Structure', type: 'lookup', lookup: { table: 'salary_structures' } }} value={structure} onChange={setStructure} /></Field>
          <Field label="Reason" required className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function AdjustmentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Bonuses, incentives & loans" description="One-time earnings or deductions are picked up by the next payroll calculation for their month. Loans and advances are recovered as monthly EMIs." />
      <Tabs defaultValue="adj">
        <TabsList><TabsTrigger value="adj">Bonuses & incentives</TabsTrigger><TabsTrigger value="loans">Loans & advances</TabsTrigger></TabsList>
        <TabsContent value="adj"><CrudPage cfg={{
          title: 'Adjustments', embedded: true, table: 'payroll_adjustments', select: '*, employees(first_name, last_name, employee_code)', permission: 'payroll.process', orderBy: { column: 'effective_month', ascending: false }, remove: 'delete',
          columns: [{ key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` }, { key: 'title', header: 'Title' }, { key: 'component_code', header: 'Code' },
            { key: 'adjustment_type', header: 'Type', cell: (r) => <Badge tone={r.adjustment_type === 'earning' ? 'success' : 'warning'}>{titleCase(r.adjustment_type)}</Badge> },
            { key: 'amount', header: 'Amount', cell: (r) => money(r.amount) }, { key: 'effective_month', header: 'Month', cell: (r) => fmtDate(r.effective_month, 'MMM yyyy') }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
          fields: [{ name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true },
            { name: 'adjustment_type', label: 'Type', type: 'select', required: true, default: 'earning', options: [{ value: 'earning', label: 'Earning' }, { value: 'deduction', label: 'Deduction' }] },
            { name: 'component_code', label: 'Code', type: 'select', required: true, default: 'BONUS', options: ['BONUS', 'INCENTIVE', 'ARREARS', 'REIMBURSEMENT', 'RECOVERY', 'OTHER'].map((v) => ({ value: v, label: titleCase(v.toLowerCase()) })) },
            { name: 'title', label: 'Title (shown on payslip)', type: 'text', required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0 },
            { name: 'effective_month', label: 'Payroll month (1st)', type: 'date', required: true }],
        }} /></TabsContent>
        <TabsContent value="loans"><CrudPage cfg={{
          title: 'Loans', embedded: true, table: 'employee_loans', select: '*, employees(first_name, last_name)', permission: 'payroll.manage', orderBy: { column: 'created_at', ascending: false }, remove: { column: 'status', value: 'written_off' },
          columns: [{ key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` }, { key: 'loan_type', header: 'Type', value: (r) => titleCase(r.loan_type) },
            { key: 'principal', header: 'Principal', cell: (r) => money(r.principal) }, { key: 'emi', header: 'EMI', cell: (r) => money(r.emi) }, { key: 'outstanding', header: 'Outstanding', cell: (r) => <span className="font-medium">{money(r.outstanding)}</span> },
            { key: 'start_month', header: 'From', cell: (r) => fmtDate(r.start_month, 'MMM yyyy') }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
          fields: [{ name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true }, { name: 'loan_type', label: 'Type', type: 'select', required: true, default: 'loan', options: [{ value: 'loan', label: 'Loan' }, { value: 'advance', label: 'Salary advance' }] },
            { name: 'principal', label: 'Principal (₹)', type: 'number', required: true, min: 1 }, { name: 'emi', label: 'Monthly EMI (₹)', type: 'number', required: true, min: 1 },
            { name: 'outstanding', label: 'Outstanding (₹)', type: 'number', required: true, min: 0, hint: 'Usually equal to principal for new loans' }, { name: 'start_month', label: 'First EMI month (1st)', type: 'date', required: true }, { name: 'remarks', label: 'Remarks', type: 'textarea' }],
        }} /></TabsContent>
      </Tabs>
    </div>
  )
}

export function FnfPage() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['payroll', 'fnf'], queryFn: () => unwrap<any[]>(db.from('fnf_settlements').select('*, employees(first_name, last_name, employee_code)').order('created_at', { ascending: false })) })
  const cases = useQuery({ queryKey: ['offboarding', 'cases-fnf'], queryFn: () => unwrap<any[]>(db.from('offboarding_cases').select('id, employee_id, approved_lwd, requested_lwd, notice_waived, status, employees(first_name, last_name)').in('status', ['in_clearance', 'completed'])) })
  const [open, setOpen] = useState<any | null>(null)
  const [compute, setCompute] = useState(false)
  const [caseId, setCaseId] = useState(''); const [waived, setWaived] = useState(false)
  const run = useAction(() => { const c = (cases.data ?? []).find((x) => x.id === caseId); return rpc('compute_fnf', { p_employee: c.employee_id, p_lwd: c.approved_lwd ?? c.requested_lwd, p_notice_waived: waived || c.notice_waived, p_case: c.id }) }, { success: 'Settlement calculated (draft)', invalidate: [['payroll', 'fnf']], onSuccess: () => setCompute(false) })
  const approve = useAction((id: string) => unwrap(db.from('fnf_settlements').update({ status: 'approved' }).eq('id', id).select('id')), { success: 'Settlement approved', invalidate: [['payroll', 'fnf']] })
  const pay = useAction(({ id, ref }: { id: string; ref: string }) => unwrap(db.from('fnf_settlements').update({ status: 'paid', paid_on: isoDate(), payment_reference: ref }).eq('id', id).select('id')), { success: 'Marked as paid', invalidate: [['payroll', 'fnf']] })
  const confirm = useConfirm()
  return (
    <div>
      <PageHeader title="Full & final settlement" description="Final-month salary, leave encashment, gratuity (per the configured rule), notice shortfall and outstanding loans — calculated from the employee’s records."
        actions={can('payroll.manage') && <Button onClick={() => setCompute(true)}><Calc /> Calculate settlement</Button>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={setOpen} exportName="F&F settlements" columns={[
        { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> },
        { key: 'last_working_day', header: 'Last day', cell: (r) => fmtDate(r.last_working_day) }, { key: 'service_years', header: 'Service', value: (r) => `${r.service_years} yrs` },
        { key: 'total_earnings', header: 'Earnings', cell: (r) => money(r.total_earnings) }, { key: 'total_deductions', header: 'Deductions', cell: (r) => money(r.total_deductions) },
        { key: 'net_payable', header: 'Net payable', cell: (r) => <span className={`font-semibold ${Number(r.net_payable) < 0 ? 'text-danger' : ''}`}>{money(r.net_payable)}</span> },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ...(can('payroll.manage') ? [{ key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r: any) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => approve.mutate(r.id)}>Approve</Button>}
            {r.status === 'approved' && <Button size="sm" variant="success" onClick={async () => { const c = await confirm({ title: 'Mark settlement paid?', requireReason: true, reasonLabel: 'Payment reference' }); if (c.ok) pay.mutate({ id: r.id, ref: c.reason! }) }}>Mark paid</Button>}
          </div>
        ) } as Column<any>] : []),
      ]} emptyTitle="No settlements yet" />
      <Dialog open={compute} onOpenChange={setCompute} title="Calculate full & final" footer={<><Button variant="secondary" onClick={() => setCompute(false)}>Cancel</Button><Button loading={run.isPending} disabled={!caseId} onClick={() => run.mutate()}>Calculate</Button></>}>
        <div className="space-y-4">
          <Field label="Exit case" required><Select value={caseId} onChange={(e) => setCaseId(e.target.value)}><option value="">Select…</option>{(cases.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.employees?.first_name} {c.employees?.last_name} — last day {fmtDate(c.approved_lwd ?? c.requested_lwd)}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} /> Waive notice period shortfall</label>
        </div>
      </Dialog>
      {open && <FnfDetail s={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function FnfDetail({ s, onClose }: { s: any; onClose: () => void }) {
  const lines = useQuery({ queryKey: ['payroll', 'fnf-lines', s.id], queryFn: () => unwrap<any[]>(db.from('fnf_lines').select('*').eq('settlement_id', s.id)) })
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`${s.employees?.first_name} ${s.employees?.last_name}`} description={`Last working day ${fmtDate(s.last_working_day)} · ${s.service_years} years of service`}>
      {(['earning', 'deduction'] as const).map((t) => (
        <div key={t} className="mb-5"><h4 className="mb-2 text-sm font-semibold">{t === 'earning' ? 'Payable' : 'Recoverable'}</h4>
          <ul className="divide-y divide-line rounded-lg border border-line">{(lines.data ?? []).filter((l) => l.line_type === t).map((l) => <li key={l.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{l.title}{l.basis && <span className="block text-xs text-muted">{l.basis}</span>}</span><span className="tnum">{money(l.amount)}</span></li>)}
            {(lines.data ?? []).filter((l) => l.line_type === t).length === 0 && <li className="px-3 py-2 text-sm text-muted">None</li>}</ul>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-lg bg-success-soft px-4 py-3"><span className="text-sm text-success">Net payable</span><span className="figure text-2xl text-success">{money(s.net_payable)}</span></div>
    </Drawer>
  )
}
