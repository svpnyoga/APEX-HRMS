import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { Cake, PartyPopper, ArrowRight } from 'lucide-react'
import { format, parseISO, subMonths } from 'date-fns'
import { db, unwrap } from '@/lib/api'
import { useAuth } from '@/app/auth'
import { useRpc } from '@/hooks/data'
import { PageHeader, StatStrip, QueryView, EmptyState } from '@/components/common/page'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { EmployeeCell } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { Card, CardHeader, Avatar, Badge } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { ago, fmtDate, money, titleCase, isoDate } from '@/lib/utils'
import { ENTITY_LABEL } from '@/modules/approvals/Inbox'

export function Celebrations() {
  const q = useRpc<any[]>(['celebrations'], 'upcoming_celebrations', { p_days: 30 })
  return (
    <Card>
      <CardHeader title="Birthdays & work anniversaries" description="Next 30 days" />
      <QueryView q={q} empty={{ when: (d) => d.length === 0, title: 'Nothing coming up' }}>
        {(d) => (
          <ul className="divide-y divide-line">
            {d.slice(0, 8).map((c, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-2.5">
                <Avatar name={c.full_name} src={c.photo_url} size={30} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.full_name}</div><div className="text-xs text-muted">{c.department_name ?? '—'}</div></div>
                <div className="text-right text-xs">
                  <div className="flex items-center justify-end gap-1 font-medium">{c.kind === 'birthday' ? <Cake className="h-3.5 w-3.5 text-danger" /> : <PartyPopper className="h-3.5 w-3.5 text-primary" />}{c.kind === 'birthday' ? 'Birthday' : `${c.years} yr${c.years > 1 ? 's' : ''}`}</div>
                  <div className="text-muted">{c.on_date === isoDate() ? 'Today' : fmtDate(c.on_date, 'dd MMM')}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </Card>
  )
}

export function HrOverview() {
  const { can } = useAuth()
  const q = useRpc<any>(['dashboard', 'summary'], 'dashboard_summary', { p_date: isoDate() })
  const d = q.data
  const trend = (d?.attendance_trend ?? []).map((t: any) => ({ ...t, day: fmtDate(t.date, 'dd MMM') }))
  const leave = (d?.leave_trend ?? []).map((t: any) => ({ month: format(parseISO(t.month + '-01'), 'MMM'), days: Number(t.days) }))
  return (
    <div className="space-y-5">
      <PageHeader title="HR overview" description={`Today, ${fmtDate(new Date(), 'EEEE d MMMM')}`}
        actions={d?.my_pending_approvals > 0 && <Link to="/leave/approvals"><Button>Review {d.my_pending_approvals} approval{d.my_pending_approvals > 1 ? 's' : ''} <ArrowRight /></Button></Link>} />
      <QueryView q={q}>
        {(d) => (
          <>
            <StatStrip items={[
              { label: 'Total employees', value: d.total_employees, hint: `${d.active_employees} active`, to: '/employees' },
              { label: 'Present today', value: d.present, tone: 'success', hint: d.active_employees ? `${Math.round((d.present / d.active_employees) * 100)}% of active` : undefined, to: '/attendance/daily' },
              { label: 'Not in yet', value: Math.max(0, d.active_employees - d.present - d.on_leave), tone: 'danger', hint: 'Not clocked in and not on leave', to: '/attendance/daily' },
              { label: 'On leave', value: d.on_leave, tone: 'primary', to: '/leave/calendar' },
              { label: 'Late today', value: d.late, tone: 'warning', to: '/attendance/late' },
              { label: 'Pending approvals', value: d.pending_approvals, hint: `${d.my_pending_approvals} assigned to you`, to: '/leave/approvals' },
            ]} />
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ChartCard title="Attendance trend" description="Last 14 days" height={280}>
                  <ResponsiveContainer>
                    <AreaChart data={trend}>
                      <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SERIES[1]} stopOpacity={0.25} /><stop offset="100%" stopColor={SERIES[1]} stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid {...GRID} /><XAxis dataKey="day" {...AXIS} /><YAxis {...AXIS} allowDecimals={false} width={30} /><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="present" name="Present" stroke={SERIES[1]} fill="url(#gp)" strokeWidth={2} />
                      <Line type="monotone" dataKey="late" name="Late" stroke={SERIES[2]} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="absent" name="Absent" stroke={SERIES[3]} strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
              <Card>
                <CardHeader title="This month" />
                <dl className="divide-y divide-line text-sm">
                  {d.payroll && can('payroll.view') && <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Payroll {fmtDate(d.payroll.month, 'MMM yyyy')}</dt><dd className="text-right"><div className="figure text-lg">{money(d.payroll.net)}</div><StatusBadge status={d.payroll.status} /></dd></div>}
                  <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Claims awaiting approval</dt><dd className="text-right"><div className="figure text-lg">{money(d.pending_claims?.amount)}</div><div className="text-xs text-muted">{d.pending_claims?.count} claims</div></dd></div>
                  <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Approved, not yet reimbursed</dt><dd className="figure text-lg">{money(d.approved_unpaid_claims)}</dd></div>
                  <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">New joiners</dt><dd className="figure text-lg">{d.new_joiners_month}</dd></div>
                  <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Exits</dt><dd className="figure text-lg">{d.exits_month}</dd></div>
                  <div className="flex items-center justify-between px-5 py-3"><dt className="text-muted">Missing check-outs (7 days)</dt><dd className="figure text-lg text-danger">{d.missing_checkout}</dd></div>
                </dl>
              </Card>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              <ChartCard title="Headcount by department" height={280}>
                <ResponsiveContainer>
                  <BarChart data={d.department_headcount} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid {...GRID} horizontal={false} vertical /><XAxis type="number" {...AXIS} allowDecimals={false} /><YAxis type="category" dataKey="name" {...AXIS} width={130} /><Tooltip {...TOOLTIP} />
                    <Bar dataKey="count" name="Employees" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Leave taken" description="Approved days, last 6 months" height={280}>
                <ResponsiveContainer>
                  <BarChart data={leave}><CartesianGrid {...GRID} /><XAxis dataKey="month" {...AXIS} /><YAxis {...AXIS} width={30} allowDecimals={false} /><Tooltip {...TOOLTIP} /><Bar dataKey="days" name="Days" fill={SERIES[4]} radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              </ChartCard>
              <Celebrations />
            </div>
            <Card>
              <CardHeader title="Recent activity" />
              {(d.recent_activity ?? []).length === 0 ? <EmptyState title="No activity yet" /> : (
                <ul className="divide-y divide-line">
                  {d.recent_activity.map((a: any, i: number) => (
                    <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <Badge>{ENTITY_LABEL[a.table_name] ?? titleCase(a.table_name ?? a.action)}</Badge>
                      <span className="min-w-0 flex-1 truncate">{a.note ?? `${titleCase(a.action)} on ${a.table_name}`}</span>
                      <span className="hidden text-muted sm:inline">{a.actor ?? 'System'}</span>
                      <span className="text-xs text-subtle">{ago(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </QueryView>
    </div>
  )
}

export function WorkforceOverview() {
  const today = isoDate()
  const att = useQuery({ queryKey: ['attendance', 'register', today, 'wf'], queryFn: () => unwrap<any[]>(db.from('v_attendance_register').select('employee_id, employee_name, employee_code, department_name, status, first_in, is_late, is_offsite, site_name').eq('work_date', today)) })
  const leave = useQuery({ queryKey: ['leave', 'upcoming'], queryFn: () => unwrap<any[]>(db.from('v_leave_register').select('*').in('status', ['approved', 'pending']).gte('end_date', today).order('start_date').limit(50)) })
  const goals = useQuery({ queryKey: ['performance', 'team-goals'], queryFn: () => unwrap<any[]>(db.from('performance_goals').select('employee_id, progress, weight, employees(first_name, last_name)').eq('status', 'active')) })
  const pending = useQuery({ queryKey: ['approvals', 'mine-pending'], queryFn: () => unwrap<any[]>(db.from('my_approval_tasks').select('*').eq('task_status', 'pending').eq('request_status', 'pending')) })
  const teamPerf = useMemo(() => {
    const m = new Map<string, { name: string; w: number; s: number }>()
    for (const g of goals.data ?? []) { const x = m.get(g.employee_id) ?? { name: `${g.employees?.first_name} ${g.employees?.last_name}`, w: 0, s: 0 }; x.w += Number(g.weight); x.s += Number(g.weight) * g.progress; m.set(g.employee_id, x) }
    return [...m.values()].map((x) => ({ name: x.name, progress: Math.round(x.s / Math.max(1, x.w)) })).sort((a, b) => b.progress - a.progress)
  }, [goals.data])
  const rows = att.data ?? []
  return (
    <div className="space-y-5">
      <PageHeader title="Workforce overview" description="Your team (or the whole organisation for HR) right now: who is in, who is away, what needs your decision." />
      <StatStrip items={[
        { label: 'In today', value: rows.filter((r) => r.first_in).length, tone: 'success' }, { label: 'Late', value: rows.filter((r) => r.is_late).length, tone: 'warning' },
        { label: 'At customer sites', value: rows.filter((r) => r.is_offsite || r.site_name).length }, { label: 'On leave', value: rows.filter((r) => r.status === 'on_leave').length, tone: 'primary' },
        { label: 'Waiting for your approval', value: pending.data?.length ?? '—', to: '/leave/approvals' },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Team attendance today" actions={<Link to="/attendance/daily" className="text-sm text-primary hover:underline">Details</Link>} />
          <QueryView q={att} empty={{ when: (d) => d.length === 0, title: 'No records yet today' }}>
            {(d) => (
              <ul className="max-h-[380px] divide-y divide-line overflow-y-auto scrollbar-thin">
                {d.map((r) => <li key={r.employee_id} className="flex items-center justify-between gap-3 px-5 py-2"><EmployeeCell name={r.employee_name} sub={r.site_name ?? r.department_name} />
                  <div className="flex items-center gap-1.5">{r.first_in && <span className="text-xs text-muted tnum">{fmtDate(r.first_in, 'HH:mm')}</span>}<StatusBadge status={r.status} />{r.is_late && <Badge tone="warning">Late</Badge>}</div></li>)}
              </ul>
            )}
          </QueryView>
        </Card>
        <Card>
          <CardHeader title="Team leave — upcoming" actions={<Link to="/leave/calendar" className="text-sm text-primary hover:underline">Calendar</Link>} />
          <QueryView q={leave} empty={{ when: (d) => d.length === 0, title: 'No upcoming leave' }}>
            {(d) => (
              <ul className="max-h-[380px] divide-y divide-line overflow-y-auto scrollbar-thin">
                {d.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5"><EmployeeCell name={l.employee_name} sub={l.leave_type_name} />
                  <div className="text-right text-xs"><div>{fmtDate(l.start_date, 'dd MMM')}{l.end_date !== l.start_date && ` – ${fmtDate(l.end_date, 'dd MMM')}`}</div><StatusBadge status={l.status} /></div></li>)}
              </ul>
            )}
          </QueryView>
        </Card>
        <ChartCard title="Goal progress" description="Weighted progress on active goals" height={Math.max(220, teamPerf.length * 30 + 40)}>
          {teamPerf.length === 0 ? <EmptyState title="No active goals" /> : (
            <ResponsiveContainer>
              <BarChart data={teamPerf} layout="vertical"><CartesianGrid {...GRID} horizontal={false} vertical /><XAxis type="number" domain={[0, 100]} {...AXIS} unit="%" /><YAxis type="category" dataKey="name" {...AXIS} width={130} /><Tooltip {...TOOLTIP} /><Bar dataKey="progress" name="Progress %" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={14} /></BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <Card>
          <CardHeader title="Pending team approvals" actions={<Link to="/leave/approvals" className="text-sm text-primary hover:underline">Open inbox</Link>} />
          <QueryView q={pending} empty={{ when: (d) => d.length === 0, title: 'Nothing waiting for you' }}>
            {(d) => <ul className="divide-y divide-line">{d.slice(0, 8).map((t) => <li key={t.task_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"><span className="min-w-0 truncate"><span className="font-medium">{t.requester_name}</span> · {t.title}</span><span className="text-xs text-subtle">{ago(t.submitted_at)}</span></li>)}</ul>}
          </QueryView>
        </Card>
      </div>
    </div>
  )
}

export function ManagementAnalytics() {
  const { can } = useAuth()
  const emp = useQuery({ queryKey: ['analytics', 'employees'], queryFn: () => unwrap<any[]>(db.from('v_employee_register').select('id, status, date_of_joining, exit_date, employment_type, department_name, gender')) })
  const pay = useQuery({ queryKey: ['analytics', 'payroll'], enabled: can('payroll.view'), queryFn: () => unwrap<any[]>(db.from('payroll_runs').select('total_gross, total_net, total_employer_cost, employee_count, payroll_periods(period_month)').order('created_at')) })
  const claims = useQuery({ queryKey: ['analytics', 'claims'], queryFn: () => unwrap<any[]>(db.from('v_claims_register').select('amount, category_name, status, expense_date').in('status', ['approved', 'reimbursed', 'submitted'])) })
  const months = Array.from({ length: 12 }).map((_, i) => subMonths(new Date(), 11 - i))
  const head = months.map((m) => {
    const end = isoDate(new Date(m.getFullYear(), m.getMonth() + 1, 0))
    const active = (emp.data ?? []).filter((e) => e.date_of_joining <= end && (!e.exit_date || e.exit_date > end)).length
    const exits = (emp.data ?? []).filter((e) => e.exit_date && e.exit_date.slice(0, 7) === format(m, 'yyyy-MM')).length
    const joins = (emp.data ?? []).filter((e) => e.date_of_joining.slice(0, 7) === format(m, 'yyyy-MM')).length
    return { month: format(m, 'MMM yy'), Headcount: active, Joiners: joins, Exits: exits }
  })
  const totalExits = head.reduce((a, h) => a + h.Exits, 0)
  const avgHead = head.reduce((a, h) => a + h.Headcount, 0) / Math.max(1, head.length)
  const byCat = Object.entries((claims.data ?? []).reduce((a: Record<string, number>, c) => ({ ...a, [c.category_name]: (a[c.category_name] ?? 0) + Number(c.amount) }), {})).map(([name, value]) => ({ name, value }))
  const types = Object.entries((emp.data ?? []).filter((e) => e.status !== 'exited').reduce((a: Record<string, number>, e) => ({ ...a, [titleCase(e.employment_type)]: (a[titleCase(e.employment_type)] ?? 0) + 1 }), {})).map(([name, value]) => ({ name, value }))
  return (
    <div className="space-y-5">
      <PageHeader title="Management analytics" description="Organisation trends over the last 12 months." />
      <StatStrip items={[
        { label: 'Current headcount', value: head[head.length - 1]?.Headcount ?? '—' },
        { label: 'Joiners (12 mo)', value: head.reduce((a, h) => a + h.Joiners, 0), tone: 'success' },
        { label: 'Exits (12 mo)', value: totalExits, tone: 'danger' },
        { label: 'Attrition rate', value: avgHead ? `${((totalExits / avgHead) * 100).toFixed(1)}%` : '—', hint: 'Exits ÷ average headcount' },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Headcount, joiners and exits" height={300}>
          <ResponsiveContainer>
            <BarChart data={head}><CartesianGrid {...GRID} /><XAxis dataKey="month" {...AXIS} /><YAxis {...AXIS} width={30} allowDecimals={false} /><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Headcount" fill={SERIES[0]} radius={[3, 3, 0, 0]} /><Bar dataKey="Joiners" fill={SERIES[1]} radius={[3, 3, 0, 0]} /><Bar dataKey="Exits" fill={SERIES[3]} radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartCard>
        {can('payroll.view') && (
          <ChartCard title="Payroll cost" description="Gross, net and employer cost per run" height={300}>
            <ResponsiveContainer>
              <LineChart data={(pay.data ?? []).map((p) => ({ month: fmtDate(p.payroll_periods?.period_month, 'MMM yy'), Gross: Number(p.total_gross), Net: Number(p.total_net), 'Employer cost': Number(p.total_employer_cost) }))}>
                <CartesianGrid {...GRID} /><XAxis dataKey="month" {...AXIS} /><YAxis {...AXIS} width={70} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} /><Tooltip {...TOOLTIP} formatter={(v: any) => money(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="Gross" stroke={SERIES[0]} strokeWidth={2} /><Line dataKey="Net" stroke={SERIES[1]} strokeWidth={2} /><Line dataKey="Employer cost" stroke={SERIES[2]} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
        <ChartCard title="Claims by category" height={300}>
          <ResponsiveContainer>
            <PieChart><Pie data={byCat} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>{byCat.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}</Pie><Tooltip {...TOOLTIP} formatter={(v: any) => money(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Workforce by employment type" height={300}>
          <ResponsiveContainer>
            <PieChart><Pie data={types} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>{types.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}</Pie><Tooltip {...TOOLTIP} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}
