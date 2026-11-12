import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, eachDayOfInterval, endOfMonth, format, startOfMonth, startOfWeek, subDays } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarCheck, ClipboardEdit, KeyRound, Plus, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useRpc } from '@/hooks/data'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { MonthCalendar, MonthNav } from '@/components/common/calendar'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { CrudPage, type CrudConfig } from '@/components/crud/CrudPage'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader } from '@/components/ui/misc'
import { cn, fmtDate, fmtTime, isoDate, minutes, titleCase } from '@/lib/utils'
import { ApprovalsInbox, MyRequestStatus } from '@/modules/approvals/Inbox'
import { ClockPanel } from './clock'

const REG_SELECT = 'id, employee_id, employee_code, employee_name, department_name, designation_name, work_date, first_in, last_out, worked_minutes, late_minutes, early_minutes, overtime_minutes, status, is_late, is_early_departure, missing_checkout, is_offsite, is_regularised, is_flagged, site_name, shift_name, remarks'

function useRegister(from: string, to: string, extra?: (q: any) => any) {
  return useQuery({
    queryKey: ['attendance', 'register', from, to, String(extra)],
    queryFn: async () => {
      let q: any = db.from('v_attendance_register').select(REG_SELECT).gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).limit(5000)
      if (extra) q = extra(q)
      return unwrap<any[]>(q)
    },
  })
}

const recordCols = (withDate = true): Column<any>[] => [
  ...(withDate ? [{ key: 'work_date', header: 'Date', value: (r: any) => r.work_date, cell: (r: any) => fmtDate(r.work_date, 'EEE dd MMM') } as Column<any>] : []),
  { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} sub={`${r.employee_code} · ${r.department_name ?? '—'}`} /> },
  { key: 'first_in', header: 'In', value: (r) => fmtTime(r.first_in), className: 'tnum' },
  { key: 'last_out', header: 'Out', value: (r) => fmtTime(r.last_out), className: 'tnum' },
  { key: 'worked_minutes', header: 'Worked', value: (r) => r.worked_minutes, cell: (r) => minutes(r.worked_minutes), className: 'tnum' },
  { key: 'status', header: 'Status', value: (r) => r.status, cell: (r) => (
    <div className="flex flex-wrap gap-1">
      <StatusBadge status={r.status} />
      {r.is_late && <Badge tone="warning">Late {r.late_minutes}m</Badge>}
      {r.is_early_departure && <Badge tone="warning">Early {r.early_minutes}m</Badge>}
      {r.missing_checkout && <Badge tone="danger">No check-out</Badge>}
      {r.is_offsite && <Badge tone="info">Off-site</Badge>}
      {r.is_regularised && <Badge tone="primary">Regularised</Badge>}
      {r.is_flagged && !r.is_regularised && <Badge tone="danger">Review</Badge>}
    </div>
  ) },
  { key: 'site_name', header: 'Site', hideOnMobile: true },
]

export function AttendanceDashboard() {
  const [range, setRange] = useState<'day' | 'week' | 'month'>('day')
  const today = new Date()
  const from = isoDate(range === 'day' ? today : range === 'week' ? startOfWeek(today, { weekStartsOn: 1 }) : startOfMonth(today))
  const to = isoDate(today)
  const s = useRpc<any>(['attendance', 'summary', from, to], 'attendance_range_summary', { p_from: from, p_to: to })
  const reg = useRegister(isoDate(subDays(today, 13)), to)
  const trend = useMemo(() => {
    const days = eachDayOfInterval({ start: subDays(today, 13), end: today })
    return days.map((d) => {
      const k = isoDate(d)
      const rs = (reg.data ?? []).filter((r) => r.work_date === k)
      return { day: format(d, 'dd MMM'), Present: rs.filter((r) => r.first_in).length, Late: rs.filter((r) => r.is_late).length, Absent: rs.filter((r) => r.status === 'absent').length, Leave: rs.filter((r) => r.status === 'on_leave').length }
    })
  }, [reg.data]) // eslint-disable-line
  const d = s.data ?? {}
  return (
    <div className="space-y-5">
      <PageHeader title="Attendance dashboard" description="Live attendance for the people you can see. Figures come from processed attendance records."
        actions={<div className="flex rounded-md border border-line bg-surface p-0.5">{(['day', 'week', 'month'] as const).map((r) => (
          <button key={r} onClick={() => setRange(r)} className={cn('rounded px-3 py-1 text-sm', range === r ? 'bg-primary text-primary-fg' : 'text-muted hover:text-text')}>{r === 'day' ? 'Today' : r === 'week' ? 'This week' : 'This month'}</button>
        ))}</div>} />
      <StatStrip items={[
        { label: 'Present', value: d.present ?? '—', tone: 'success', to: '/attendance/daily' },
        { label: 'Absent', value: d.absent ?? '—', tone: 'danger', to: '/attendance/daily' },
        { label: 'Late arrivals', value: d.late ?? '—', tone: 'warning', to: '/attendance/late' },
        { label: 'On leave', value: d.on_leave ?? '—', tone: 'primary', to: '/leave/calendar' },
        { label: 'Off-site', value: d.offsite ?? '—', to: '/field/site-attendance' },
        { label: 'Missing check-outs', value: d.missing_checkout ?? '—', tone: 'danger', to: '/attendance/missing-checkout' },
      ]} />
      <StatStrip items={[
        { label: 'Total hours worked', value: Math.round((d.worked_minutes ?? 0) / 60).toLocaleString('en-IN') },
        { label: 'Overtime', value: minutes(d.overtime_minutes), to: '/attendance/overtime' },
        { label: 'Attendance %', value: d.attendance_pct != null ? `${d.attendance_pct}%` : '—', hint: 'Present ÷ working days (excl. leave, holidays)' },
        { label: 'Early departures', value: d.early ?? '—', to: '/attendance/early' },
      ]} />
      <ChartCard title="Last 14 days" description="Daily headcount by status" height={300}>
        <ResponsiveContainer>
          <BarChart data={trend} barGap={2}>
            <CartesianGrid {...GRID} /><XAxis dataKey="day" {...AXIS} /><YAxis {...AXIS} allowDecimals={false} width={30} /><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Present" fill={SERIES[1]} radius={[3, 3, 0, 0]} /><Bar dataKey="Late" fill={SERIES[2]} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Absent" fill={SERIES[3]} radius={[3, 3, 0, 0]} /><Bar dataKey="Leave" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}

function ManualAttendanceDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial?: { employee_id?: string; work_date?: string } }) {
  const [emp, setEmp] = useState<string | null>(initial?.employee_id ?? null)
  const [date, setDate] = useState(initial?.work_date ?? isoDate())
  const [tin, setIn] = useState('09:30'); const [tout, setOut] = useState('18:30'); const [reason, setReason] = useState('')
  const save = useAction(() => rpc('manual_attendance', { p_employee: emp, p_date: date, p_in: tin || null, p_out: tout || null, p_reason: reason }), {
    success: 'Attendance recorded and marked regularised', invalidate: [['attendance']], onSuccess: () => onOpenChange(false),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Manual attendance" description="For HR use when an employee could not punch. Recorded in the audit log."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} disabled={!emp || !reason.trim()} onClick={() => save.mutate()}>Save attendance</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={emp} onChange={setEmp} /></Field>
        <Field label="Date" required><Input type="date" value={date} max={isoDate()} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="In"><Input type="time" value={tin} onChange={(e) => setIn(e.target.value)} /></Field><Field label="Out"><Input type="time" value={tout} onChange={(e) => setOut(e.target.value)} /></Field></div>
        <Field label="Reason" required className="sm:col-span-2"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Biometric device offline at Hosur gate" /></Field>
      </div>
    </Dialog>
  )
}

export function DailyAttendance() {
  const { can } = useAuth()
  const confirm = useConfirm()
  const [date, setDate] = useState(isoDate())
  const [status, setStatus] = useState('')
  const [manual, setManual] = useState<{ employee_id?: string; work_date?: string } | null>(null)
  const reg = useRegister(date, date, status ? (q) => q.eq('status', status) : undefined)
  const confirmAbsence = useAction(({ id, remarks }: { id: string; remarks?: string }) => rpc('confirm_absence', { p_record: id, p_remarks: remarks ?? 'Confirmed by HR' }), { success: 'Absence confirmed', invalidate: [['attendance']] })
  const cols: Column<any>[] = [...recordCols(false), ...(can('attendance.manage') ? [{
    key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r: any) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setManual({ employee_id: r.employee_id, work_date: r.work_date })}><ClipboardEdit /> Correct</Button>
        {r.status === 'absent' && <Button size="sm" variant="ghost" onClick={async () => { const c = await confirm({ title: `Confirm ${r.employee_name} absent?`, requireReason: true, reasonLabel: 'Remarks' }); if (c.ok) confirmAbsence.mutate({ id: r.id, remarks: c.reason }) }}><UserX /> Confirm absent</Button>}
      </div>
    ),
  } as Column<any>] : [])]
  return (
    <div>
      <PageHeader title="Daily attendance" description="Every employee's record for the selected day, including flags for late, early, missing check-out and off-site punches."
        actions={can('attendance.manage') && <Button onClick={() => setManual({})}><Plus /> Manual attendance</Button>} />
      <DataTable rows={reg.data} columns={cols} loading={reg.isLoading} error={reg.error} onRetry={() => reg.refetch()} exportName={`Attendance ${date}`}
        toolbar={<>
          <Input type="date" value={date} max={isoDate()} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Date" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status">
            <option value="">All statuses</option>{['present', 'half_day', 'incomplete', 'absent', 'on_leave', 'holiday', 'weekly_off'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
        </>}
        emptyTitle="No attendance records for this day" emptyDescription="Records appear as people clock in, and the day is closed automatically after midnight." />
      {manual && <ManualAttendanceDialog open={!!manual} onOpenChange={(o) => !o && setManual(null)} initial={manual} />}
    </div>
  )
}

const CELL: Record<string, { label: string; cls: string }> = {
  present: { label: 'P', cls: 'bg-success-soft text-success' }, half_day: { label: 'H', cls: 'bg-warning-soft text-warning' }, incomplete: { label: 'I', cls: 'bg-warning-soft text-warning' },
  absent: { label: 'A', cls: 'bg-danger-soft text-danger' }, on_leave: { label: 'L', cls: 'bg-primary-soft text-primary' }, holiday: { label: 'Ho', cls: 'bg-info-soft text-info' },
  weekly_off: { label: 'W', cls: 'bg-raised text-subtle' },
}

export function MonthlyRegister() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const from = isoDate(month), to = isoDate(endOfMonth(month))
  const reg = useRegister(from, to)
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) })
  const people = useMemo(() => {
    const m = new Map<string, any>()
    for (const r of reg.data ?? []) {
      if (!m.has(r.employee_id)) m.set(r.employee_id, { id: r.employee_id, name: r.employee_name, code: r.employee_code, days: {} as Record<string, any> })
      m.get(r.employee_id).days[r.work_date] = r
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [reg.data])
  const exportRows = people.map((p) => ({ name: p.name, code: p.code, ...Object.fromEntries(days.map((d) => [isoDate(d), CELL[p.days[isoDate(d)]?.status]?.label ?? ''])),
    present: Object.values(p.days).filter((r: any) => r.status === 'present').length, late: Object.values(p.days).filter((r: any) => r.is_late).length }))
  return (
    <div>
      <PageHeader title="Monthly attendance register" description="One row per employee, one column per day. P present · H half day · I incomplete · A absent · L leave · Ho holiday · W weekly off. Amber dot = late."
        actions={<>
          <MonthNav month={month} onChange={setMonth} />
          <Button variant="secondary" onClick={async () => { const { exportExcel } = await import('@/lib/export'); exportExcel(`Attendance register ${format(month, 'MMM yyyy')}`, [{ key: 'code', header: 'Code' }, { key: 'name', header: 'Employee' }, ...days.map((d) => ({ key: isoDate(d), header: format(d, 'd') })), { key: 'present', header: 'Present' }, { key: 'late', header: 'Late' }], exportRows) }}>Export Excel</Button>
        </>} />
      <Card className="overflow-x-auto scrollbar-thin">
        {reg.isLoading ? <div className="p-6 text-sm text-muted">Loading register…</div> : people.length === 0 ? <div className="p-10 text-center text-sm text-muted">No records for this month</div> : (
          <table className="text-xs">
            <thead className="bg-raised text-muted">
              <tr><th className="sticky left-0 z-10 min-w-[180px] bg-raised px-3 py-2 text-left font-medium">Employee</th>
                {days.map((d) => <th key={d.toISOString()} className={cn('w-8 px-0.5 py-2 text-center font-medium', [0, 6].includes(d.getDay()) && 'text-subtle')}>{format(d, 'd')}<div className="text-[10px] font-normal">{format(d, 'EEEEE')}</div></th>)}
                <th className="px-2 text-right font-medium">P</th><th className="px-2 text-right font-medium">A</th><th className="px-2 text-right font-medium">Late</th><th className="px-3 text-right font-medium">Hours</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map((p) => {
                const rs = Object.values(p.days) as any[]
                return (
                  <tr key={p.id}>
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1.5"><div className="font-medium">{p.name}</div><div className="text-subtle">{p.code}</div></td>
                    {days.map((d) => {
                      const r = p.days[isoDate(d)]
                      const c = r ? CELL[r.status] : null
                      return (
                        <td key={d.toISOString()} className="px-0.5 py-1 text-center">
                          {c ? <span title={`${r.status}${r.first_in ? ` · ${fmtTime(r.first_in)}–${fmtTime(r.last_out)}` : ''}`} className={cn('relative inline-flex h-6 w-7 items-center justify-center rounded font-semibold', c.cls)}>
                            {c.label}{r.is_late && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-surface" />}
                          </span> : <span className="text-line">·</span>}
                        </td>
                      )
                    })}
                    <td className="px-2 text-right tnum">{rs.filter((r) => r.status === 'present').length}</td>
                    <td className="px-2 text-right tnum text-danger">{rs.filter((r) => r.status === 'absent').length}</td>
                    <td className="px-2 text-right tnum text-warning">{rs.filter((r) => r.is_late).length}</td>
                    <td className="px-3 text-right tnum">{Math.round(rs.reduce((a, r) => a + r.worked_minutes, 0) / 60)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

export function AttendanceCalendarView({ employeeId, compact }: { employeeId: string; compact?: boolean }) {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const from = isoDate(startOfWeek(month, { weekStartsOn: 1 })), to = isoDate(addDays(endOfMonth(month), 7))
  const reg = useRegister(from, to, (q) => q.eq('employee_id', employeeId))
  const hol = useQuery({ queryKey: ['holidays', from], queryFn: () => unwrap<any[]>(db.from('holidays').select('holiday_date, name').gte('holiday_date', from).lte('holiday_date', to)) })
  const by = new Map((reg.data ?? []).map((r) => [r.work_date, r]))
  const holBy = new Map((hol.data ?? []).map((h) => [h.holiday_date, h.name]))
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><MonthNav month={month} onChange={setMonth} /></div>
      <MonthCalendar month={month} renderDay={(d) => {
        const r = by.get(isoDate(d)); const h = holBy.get(isoDate(d))
        return (
          <div className="space-y-1">
            {h && <div className="truncate rounded bg-info-soft px-1 py-0.5 text-[11px] text-info">{h}</div>}
            {r && <StatusBadge status={r.status} />}
            {r?.first_in && !compact && <div className="tnum text-[11px] text-muted">{fmtTime(r.first_in)}–{fmtTime(r.last_out)}</div>}
            {r?.is_late && <div className="text-[11px] text-warning">Late {r.late_minutes}m</div>}
          </div>
        )
      }} />
    </div>
  )
}

export function AttendanceCalendarPage() {
  const { employeeId } = useMe()
  const { can } = useAuth()
  const [emp, setEmp] = useState<string | null>(employeeId)
  return (
    <div>
      <PageHeader title="Attendance calendar" description="Day-by-day attendance with holidays."
        actions={can(['attendance.view', 'attendance.view_team']) && <div className="w-72"><EmployeePicker value={emp} onChange={setEmp} /></div>} />
      {emp ? <AttendanceCalendarView employeeId={emp} /> : <Card className="p-6 text-sm text-muted">Select an employee.</Card>}
    </div>
  )
}

export function ClockPage() {
  return (<div><PageHeader title="Clock in / clock out" description="Face verification with liveness, optional site and GPS. Works offline — punches sync when you reconnect." /><ClockPanel /></div>)
}

export function AttendanceExceptions({ kind }: { kind: 'late' | 'early' | 'missing' }) {
  const [from, setFrom] = useState(isoDate(startOfMonth(new Date())))
  const [to, setTo] = useState(isoDate())
  const reg = useRegister(from, to, (q) => (kind === 'late' ? q.eq('is_late', true) : kind === 'early' ? q.eq('is_early_departure', true) : q.eq('missing_checkout', true)))
  const meta = { late: { t: 'Late arrivals', d: 'Check-ins after the shift start plus the grace period. Approved permissions are excluded automatically.' },
    early: { t: 'Early departures', d: 'Check-outs before the shift end minus the early-departure allowance.' },
    missing: { t: 'Missing check-outs', d: 'Days with a check-in but no check-out. Employees can submit regularisation; HR can correct directly.' } }[kind]
  const byEmp = useMemo(() => {
    const m = new Map<string, { name: string; n: number; mins: number }>()
    for (const r of reg.data ?? []) { const x = m.get(r.employee_id) ?? { name: r.employee_name, n: 0, mins: 0 }; x.n++; x.mins += kind === 'late' ? r.late_minutes : kind === 'early' ? r.early_minutes : 0; m.set(r.employee_id, x) }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5)
  }, [reg.data, kind])
  return (
    <div className="space-y-5">
      <PageHeader title={meta.t} description={meta.d} />
      <StatStrip items={[{ label: 'Occurrences', value: reg.data?.length ?? '—', tone: 'warning' }, { label: 'People affected', value: new Set((reg.data ?? []).map((r) => r.employee_id)).size },
        ...byEmp.slice(0, 3).map((x) => ({ label: x.name, value: x.n, hint: kind !== 'missing' ? `${minutes(x.mins)} total` : undefined }))]} />
      <DataTable rows={reg.data} columns={[...recordCols(true), ...(kind !== 'missing' ? [{ key: 'mins', header: kind === 'late' ? 'Late by' : 'Left early by', value: (r: any) => (kind === 'late' ? r.late_minutes : r.early_minutes), cell: (r: any) => minutes(kind === 'late' ? r.late_minutes : r.early_minutes) } as Column<any>] : [])]}
        loading={reg.isLoading} error={reg.error} exportName={meta.t}
        toolbar={<><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From" /><span className="text-muted">to</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To" /></>} />
    </div>
  )
}

export function OvertimePage() {
  const { can } = useAuth()
  const q = useQuery({ queryKey: ['attendance', 'overtime'], queryFn: () => unwrap<any[]>(db.from('overtime_records').select('*, employees(employee_code, first_name, last_name)').order('work_date', { ascending: false }).limit(1000)) })
  const decide = useAction(({ id, approve }: { id: string; approve: boolean }) => rpc('decide_overtime', { p_id: id, p_approve: approve }), { success: 'Overtime updated', invalidate: [['attendance', 'overtime']] })
  const approver = can(['attendance.manage', 'attendance.view_team'])
  const rows = (q.data ?? []).map((r) => ({ ...r, name: `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim(), code: r.employees?.employee_code }))
  return (
    <div className="space-y-5">
      <PageHeader title="Overtime" description="Overtime is detected automatically when worked time exceeds the shift by the configured minimum. Approved overtime is paid in the next payroll run." />
      <StatStrip items={[{ label: 'Pending approval', value: rows.filter((r) => r.status === 'pending').length, tone: 'warning' }, { label: 'Approved hours (unpaid)', value: Math.round(rows.filter((r) => r.status === 'approved' && !r.payroll_run_id).reduce((a, r) => a + (r.approved_minutes ?? 0), 0) / 60) },
        { label: 'Paid in payroll', value: rows.filter((r) => r.payroll_run_id).length }]} />
      <DataTable rows={rows} loading={q.isLoading} error={q.error} exportName="Overtime" columns={[
        { key: 'work_date', header: 'Date', cell: (r) => fmtDate(r.work_date) },
        { key: 'name', header: 'Employee', cell: (r) => <EmployeeCell name={r.name} code={r.code} /> },
        { key: 'minutes', header: 'Detected', value: (r) => r.minutes, cell: (r) => minutes(r.minutes) },
        { key: 'approved_minutes', header: 'Approved', value: (r) => r.approved_minutes, cell: (r) => (r.approved_minutes != null ? minutes(r.approved_minutes) : '—') },
        { key: 'status', header: 'Status', cell: (r) => <div className="flex gap-1"><StatusBadge status={r.status} />{r.payroll_run_id && <Badge tone="success">Paid</Badge>}</div> },
        ...(approver ? [{ key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r: any) => r.status === 'pending' && (
          <div className="flex justify-end gap-1"><Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, approve: false })}>Reject</Button><Button size="sm" variant="success" onClick={() => decide.mutate({ id: r.id, approve: true })}>Approve</Button></div>
        ) } as Column<any>] : []),
      ]} />
    </div>
  )
}

export function RegularisationForm({ onDone }: { onDone?: () => void }) {
  const [kind, setKind] = useState<'regularisation' | 'permission'>('regularisation')
  const [date, setDate] = useState(isoDate(subDays(new Date(), 1)))
  const [tin, setIn] = useState('09:30'); const [tout, setOut] = useState('18:30')
  const [type, setType] = useState('missed_punch'); const [reason, setReason] = useState('')
  const submit = useAction(() => kind === 'regularisation'
    ? rpc('request_regularisation', { p_date: date, p_in: tin || null, p_out: tout || null, p_type: type, p_reason: reason })
    : rpc('request_attendance_permission', { p_date: date, p_from: tin, p_to: tout, p_type: type === 'official' ? 'official' : 'personal', p_reason: reason }), {
    success: 'Request submitted to your manager', invalidate: [['attendance'], ['my-requests']], onSuccess: () => { setReason(''); onDone?.() },
  })
  return (
    <div className="space-y-4">
      <div className="flex rounded-md border border-line p-0.5 text-sm">
        <button className={cn('flex-1 rounded py-1.5', kind === 'regularisation' ? 'bg-primary text-primary-fg' : 'text-muted')} onClick={() => setKind('regularisation')}>Fix a punch</button>
        <button className={cn('flex-1 rounded py-1.5', kind === 'permission' ? 'bg-primary text-primary-fg' : 'text-muted')} onClick={() => { setKind('permission'); setType('personal'); setIn('16:30'); setOut('18:30') }}>Permission (short leave)</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" required><Input type="date" value={date} max={kind === 'regularisation' ? isoDate() : undefined} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={kind === 'regularisation' ? 'Correct check-in' : 'From'}><Input type="time" value={tin} onChange={(e) => setIn(e.target.value)} /></Field>
        <Field label={kind === 'regularisation' ? 'Correct check-out' : 'To'}><Input type="time" value={tout} onChange={(e) => setOut(e.target.value)} /></Field>
        <Field label="Type" className="sm:col-span-3">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {kind === 'regularisation' ? ['missed_punch', 'wrong_punch', 'on_duty', 'work_from_home', 'other'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)
              : <><option value="personal">Personal</option><option value="official">Official work</option></>}
          </Select>
        </Field>
        <Field label="Reason" required className="sm:col-span-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
      <Button loading={submit.isPending} disabled={!reason.trim()} onClick={() => submit.mutate()}>Submit request</Button>
    </div>
  )
}

export function RegularisationPage() {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ['attendance', 'regularisation'], queryFn: () => unwrap<any[]>(db.from('attendance_regularisation').select('*, employees(employee_code, first_name, last_name)').order('created_at', { ascending: false }).limit(1000)) })
  const perms = useQuery({ queryKey: ['attendance', 'permissions'], queryFn: () => unwrap<any[]>(db.from('attendance_permissions').select('*, employees(employee_code, first_name, last_name)').order('created_at', { ascending: false }).limit(1000)) })
  const name = (r: any) => `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`.trim()
  const [detail, setDetail] = useState<any | null>(null)
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance regularisation" description="Requests to correct punches or take short permission. They go through your approval workflow; approved corrections update the attendance record automatically."
        actions={can('attendance.clock') && <Button onClick={() => setOpen(true)}><CalendarCheck /> New request</Button>} />
      <ApprovalsInbox entityTypes={['attendance_regularisation', 'attendance_permission']} embedded />
      <Card><CardHeader title="Regularisation requests" />
        <div className="p-3"><DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Regularisation requests" onRowClick={setDetail} columns={[
          { key: 'work_date', header: 'Date', cell: (r) => fmtDate(r.work_date) }, { key: 'name', header: 'Employee', value: name },
          { key: 'request_type', header: 'Type', value: (r) => titleCase(r.request_type) },
          { key: 'times', header: 'Requested', value: (r) => `${fmtTime(r.requested_in)} – ${fmtTime(r.requested_out)}` },
          { key: 'reason', header: 'Reason', hideOnMobile: true }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]} /></div>
      </Card>
      <Card><CardHeader title="Permission requests" />
        <div className="p-3"><DataTable rows={perms.data} loading={perms.isLoading} error={perms.error} exportName="Permission requests" columns={[
          { key: 'work_date', header: 'Date', cell: (r) => fmtDate(r.work_date) }, { key: 'name', header: 'Employee', value: name },
          { key: 'times', header: 'Time', value: (r) => `${fmtTime(r.from_time)} – ${fmtTime(r.to_time)}` }, { key: 'minutes', header: 'Duration', value: (r) => minutes(r.minutes) },
          { key: 'permission_type', header: 'Type', value: (r) => titleCase(r.permission_type) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        ]} /></div>
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="New attendance request"><RegularisationForm onDone={() => setOpen(false)} /></Dialog>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title="Request history" description={detail ? `${name(detail)} · ${fmtDate(detail.work_date)}` : ''}>
        {detail && <MyRequestStatus entityType="attendance_regularisation" entityId={detail.id} />}
      </Dialog>
    </div>
  )
}

// ---------- configuration pages ----------
export const shiftsCfg: CrudConfig = {
  title: 'Shifts', description: 'Working hours used for late, early and overtime calculation. The default shift applies when no schedule is assigned.',
  table: 'shifts', permission: 'attendance.manage', orderBy: { column: 'start_time' }, remove: { column: 'is_active', value: false },
  columns: [
    { key: 'name', header: 'Shift', cell: (r) => <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.name}{r.is_default && <Badge tone="primary">Default</Badge>}{!r.is_active && <Badge>Archived</Badge>}</span> },
    { key: 'hours', header: 'Hours', value: (r) => `${fmtTime(r.start_time)} – ${fmtTime(r.end_time)}` },
    { key: 'break_minutes', header: 'Break', value: (r) => `${r.break_minutes} min` },
    { key: 'grace_minutes', header: 'Grace', value: (r) => (r.grace_minutes == null ? 'Company default' : `${r.grace_minutes} min`) },
    { key: 'weekly_off_days', header: 'Weekly off', value: (r) => (r.weekly_off_days ? r.weekly_off_days.map((d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : 'Company default') },
  ],
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true }, { name: 'code', label: 'Code', type: 'text' },
    { name: 'start_time', label: 'Start', type: 'time', required: true }, { name: 'end_time', label: 'End', type: 'time', required: true },
    { name: 'break_minutes', label: 'Break (minutes)', type: 'number', min: 0, default: 60, required: true },
    { name: 'grace_minutes', label: 'Grace (minutes)', type: 'number', min: 0, max: 120, hint: 'Leave empty to use the company grace period' },
    { name: 'weekly_off_days', label: 'Weekly off days (empty = company default)', type: 'weekdays' },
    { name: 'color', label: 'Colour', type: 'color', default: '#4338CA' },
    { name: 'is_night_shift', label: 'Night shift (crosses midnight)', type: 'switch' }, { name: 'is_default', label: 'Default shift', type: 'switch' },
    { name: 'is_active', label: 'Active', type: 'switch', default: true },
  ],
  transform: (v) => ({ ...v, weekly_off_days: v.weekly_off_days?.length ? v.weekly_off_days : null }),
}
export const ShiftsPage = () => <CrudPage cfg={shiftsCfg} />

export const SchedulesPage = () => <CrudPage cfg={{
  title: 'Work schedules', description: 'Assign a shift to an employee for a period. This overrides their default shift (e.g. rotations or plant shifts).',
  table: 'attendance_schedules', select: '*, employees(first_name, last_name, employee_code), shifts(name)', permission: 'attendance.manage', orgScoped: false,
  orderBy: { column: 'effective_from', ascending: false }, remove: 'delete',
  columns: [
    { key: 'employee', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> },
    { key: 'shift', header: 'Shift', value: (r) => r.shifts?.name }, { key: 'effective_from', header: 'From', cell: (r) => fmtDate(r.effective_from) },
    { key: 'effective_to', header: 'To', cell: (r) => (r.effective_to ? fmtDate(r.effective_to) : 'Open-ended') }, { key: 'remarks', header: 'Remarks', hideOnMobile: true },
  ],
  fields: [
    { name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true },
    { name: 'shift_id', label: 'Shift', type: 'lookup', lookup: { table: 'shifts', filter: (q) => q.eq('is_active', true) }, required: true },
    { name: 'effective_from', label: 'From', type: 'date', required: true }, { name: 'effective_to', label: 'To', type: 'date' },
    { name: 'remarks', label: 'Remarks', type: 'text', wide: true },
  ],
}} />

export const holidaysCfg: CrudConfig = {
  title: 'Holidays', description: 'Public, festival and company holidays. Optional holidays do not change attendance status. Location-specific holidays apply only to that location.',
  table: 'holidays', select: '*, locations(name)', permission: 'attendance.manage', orderBy: { column: 'holiday_date' }, remove: 'delete',
  columns: [
    { key: 'holiday_date', header: 'Date', cell: (r) => fmtDate(r.holiday_date, 'EEE, dd MMM yyyy') }, { key: 'name', header: 'Holiday' },
    { key: 'holiday_type', header: 'Type', cell: (r) => <Badge tone={r.holiday_type === 'optional' ? 'neutral' : 'info'}>{titleCase(r.holiday_type)}</Badge> },
    { key: 'location', header: 'Applies to', value: (r) => r.locations?.name ?? 'All locations' },
  ],
  fields: [
    { name: 'holiday_date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'holiday_type', label: 'Type', type: 'select', required: true, default: 'public', options: ['public', 'festival', 'optional', 'company'].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: 'location_id', label: 'Location (empty = all)', type: 'lookup', lookup: { table: 'locations' } },
  ],
}
export function HolidaysPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const q = useQuery({ queryKey: ['crud', 'holidays'], queryFn: () => unwrap<any[]>(db.from('holidays').select('*')) })
  const by = new Map((q.data ?? []).map((h) => [h.holiday_date, h]))
  return (
    <div className="space-y-5">
      <CrudPage cfg={holidaysCfg} />
      <div className="flex items-center justify-between"><h2 className="font-semibold">Calendar view</h2><MonthNav month={month} onChange={setMonth} /></div>
      <MonthCalendar month={month} renderDay={(d) => { const h = by.get(isoDate(d)); return h ? <div className="rounded bg-info-soft px-1 py-0.5 text-[11px] text-info">{h.name}</div> : null }} />
    </div>
  )
}

export function DevicesPage() {
  const [key, setKey] = useState<{ device: string; key: string } | null>(null)
  const regen = async (row: any) => {
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))).map((b) => b.toString(16).padStart(2, '0')).join('')
    const { error } = await db.from('attendance_devices').update({ api_key_hash: hash }).eq('id', row.id)
    if (error) return toast.error(error.message)
    setKey({ device: row.name, key: `${row.id}.${raw}` })
  }
  return (
    <>
      <CrudPage cfg={{
        title: 'Biometric devices', description: 'Fingerprint, RFID or face terminals push punches to the biometric-push edge function using a per-device key. Map device user codes to employees below.',
        table: 'attendance_devices', select: '*, work_sites(name)', permission: 'attendance.devices', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
        columns: [
          { key: 'name', header: 'Device' }, { key: 'device_type', header: 'Type', value: (r) => titleCase(r.device_type) }, { key: 'vendor', header: 'Vendor', hideOnMobile: true },
          { key: 'serial_number', header: 'Serial', hideOnMobile: true }, { key: 'site', header: 'Site', value: (r) => r.work_sites?.name },
          { key: 'key', header: 'API key', value: (r) => (r.api_key_hash ? 'Issued' : 'Not issued'), cell: (r) => <Badge tone={r.api_key_hash ? 'success' : 'warning'}>{r.api_key_hash ? 'Issued' : 'Not issued'}</Badge> },
          { key: 'last_seen_at', header: 'Last seen', cell: (r) => (r.last_seen_at ? fmtDate(r.last_seen_at, 'dd MMM HH:mm') : 'Never') },
        ],
        rowActions: (r) => <Button size="sm" variant="ghost" onClick={() => regen(r)}><KeyRound /> {r.api_key_hash ? 'Rotate key' : 'Issue key'}</Button>,
        fields: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'device_type', label: 'Type', type: 'select', required: true, options: ['fingerprint', 'face_terminal', 'rfid', 'kiosk'].map((v) => ({ value: v, label: titleCase(v) })) },
          { name: 'vendor', label: 'Vendor', type: 'text' }, { name: 'serial_number', label: 'Serial number', type: 'text' },
          { name: 'site_id', label: 'Site', type: 'lookup', lookup: { table: 'work_sites' } }, { name: 'is_active', label: 'Active', type: 'switch', default: true },
        ],
      }} />
      <div className="mt-6"><CrudPage cfg={{
        title: 'Device user mappings', embedded: true, table: 'device_user_mappings', select: '*, attendance_devices(name), employees(first_name, last_name, employee_code)', permission: 'attendance.devices', orgScoped: false,
        queryKey: ['crud', 'device_user_mappings'], remove: 'delete',
        columns: [{ key: 'device', header: 'Device', value: (r) => r.attendance_devices?.name }, { key: 'device_user_code', header: 'Device user code' },
          { key: 'employee', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name} (${r.employees?.employee_code})` }],
        fields: [{ name: 'device_id', label: 'Device', type: 'lookup', lookup: { table: 'attendance_devices' }, required: true },
          { name: 'device_user_code', label: 'User code on device', type: 'text', required: true }, { name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true }],
      }} /></div>
      <Dialog open={!!key} onOpenChange={(o) => !o && setKey(null)} title={`API key for ${key?.device}`} description="Copy it now — it is stored only as a hash and cannot be shown again.">
        <code className="block break-all rounded-md bg-raised p-3 text-sm">{key?.key}</code>
        <p className="mt-3 text-sm text-muted">Configure the device (or its middleware) to POST punches to <code>/functions/v1/biometric-push</code> with header <code>x-device-key</code>. See docs/INTEGRATIONS.md.</p>
      </Dialog>
    </>
  )
}
