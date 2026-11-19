import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Rocket, Plus, Star, MessageSquarePlus } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip, QueryView, EmptyState } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { CrudPage } from '@/components/crud/CrudPage'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader, Progress } from '@/components/ui/misc'
import { cn, fmtDate, titleCase, ago } from '@/lib/utils'

const useCycles = () => useLookup<any>('appraisal_cycles', 'id, name, status, period_start, period_end, rating_scale_id, self_review_due, manager_review_due', 'period_start')

export function PerformanceDashboard() {
  const cycles = useCycles()
  const active = (cycles.data ?? []).filter((c) => c.status !== 'closed').slice(-1)[0]
  const reviews = useQuery({ queryKey: ['performance', 'reviews', active?.id], enabled: !!active, queryFn: () => unwrap<any[]>(db.from('v_appraisal_register').select('*').eq('cycle_id', active.id)) })
  const goals = useQuery({ queryKey: ['performance', 'goals', 'cycle', active?.id], enabled: !!active, queryFn: () => unwrap<any[]>(db.from('performance_goals').select('progress, weight, employee_id').eq('cycle_id', active.id)) })
  const rs = reviews.data ?? []
  const pct = (stage: string) => { const s = rs.filter((r) => r.stage === stage); return s.length ? Math.round((s.filter((r) => r.status === 'submitted').length / s.length) * 100) : 0 }
  const dist = [1, 2, 3, 4, 5].map((v) => ({ rating: String(v), count: rs.filter((r) => r.stage === 'manager' && r.overall_rating === v).length }))
  return (
    <div className="space-y-5">
      <PageHeader title="Appraisal dashboard" description={active ? `${active.name} · ${fmtDate(active.period_start)} – ${fmtDate(active.period_end)}` : 'No active cycle'} />
      {!active ? <Card><EmptyState title="No active appraisal cycle" description="Create a cycle under Appraisal Cycles." /></Card> : (
        <>
          <StatStrip items={[
            { label: 'Cycle status', value: titleCase(active.status) }, { label: 'Goals set', value: (goals.data ?? []).length, hint: `${new Set((goals.data ?? []).map((g) => g.employee_id)).size} employees` },
            { label: 'Self assessments', value: `${pct('self')}%`, tone: 'primary' }, { label: 'Manager reviews', value: `${pct('manager')}%`, tone: 'primary' }, { label: 'HR reviews', value: `${pct('hr')}%`, tone: 'primary' },
          ]} />
          <ChartCard title="Manager rating distribution" height={260}>
            <ResponsiveContainer><BarChart data={dist}><CartesianGrid {...GRID} /><XAxis dataKey="rating" {...AXIS} /><YAxis {...AXIS} allowDecimals={false} width={30} /><Tooltip {...TOOLTIP} /><Bar dataKey="count" name="Employees" fill={SERIES[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  )
}

export function CyclesPage() {
  const confirm = useConfirm()
  const launch = useAction((id: string) => rpc<number>('launch_appraisal_reviews', { p_cycle: id }), { success: (n) => `Reviews opened for ${n} employees`, invalidate: [['crud', 'appraisal_cycles'], ['performance']] })
  return <CrudPage cfg={{
    title: 'Appraisal cycles', description: 'Annual, half-yearly or quarterly. Launching opens self, manager and HR review stages for every active employee.',
    table: 'appraisal_cycles', select: '*, rating_scales(name)', permission: 'performance.manage', orderBy: { column: 'period_start', ascending: false }, remove: 'delete',
    columns: [{ key: 'name', header: 'Cycle', cell: (r) => <span className="font-medium">{r.name}</span> }, { key: 'cycle_type', header: 'Type', value: (r) => titleCase(r.cycle_type) },
      { key: 'period', header: 'Period', value: (r) => `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}` }, { key: 'self_review_due', header: 'Self due', cell: (r) => fmtDate(r.self_review_due) },
      { key: 'scale', header: 'Rating scale', value: (r) => r.rating_scales?.name }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
    rowActions: (r) => ['draft', 'goal_setting'].includes(r.status) && <Button size="sm" variant="secondary" onClick={async () => { if ((await confirm({ title: `Launch reviews for ${r.name}?`, description: 'Employees are notified to complete their self assessment.' })).ok) launch.mutate(r.id) }}><Rocket /> Launch reviews</Button>,
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'cycle_type', label: 'Type', type: 'select', required: true, default: 'annual', options: ['annual', 'half_yearly', 'quarterly'].map((v) => ({ value: v, label: titleCase(v) })) },
      { name: 'period_start', label: 'Period start', type: 'date', required: true }, { name: 'period_end', label: 'Period end', type: 'date', required: true },
      { name: 'self_review_due', label: 'Self review due', type: 'date' }, { name: 'manager_review_due', label: 'Manager review due', type: 'date' }, { name: 'hr_review_due', label: 'HR review due', type: 'date' },
      { name: 'rating_scale_id', label: 'Rating scale', type: 'lookup', lookup: { table: 'rating_scales' }, required: true },
      { name: 'status', label: 'Status', type: 'select', required: true, default: 'draft', options: ['draft', 'goal_setting', 'in_review', 'closed'].map((v) => ({ value: v, label: titleCase(v) })) }],
  }} />
}

export function GoalsPage({ mineOnly }: { mineOnly?: boolean }) {
  const { employeeId } = useMe()
  const { can, access } = useAuth()
  const cycles = useCycles()
  const [cycle, setCycle] = useState('')
  const cy = cycle || (cycles.data ?? []).slice(-1)[0]?.id
  const q = useQuery({ queryKey: ['performance', 'goals-list', cy, mineOnly], enabled: !!cy, queryFn: async () => {
    let x = db.from('performance_goals').select('*, employees(first_name, last_name, employee_code), performance_kpis(name)').eq('cycle_id', cy).order('created_at')
    if (mineOnly) x = x.eq('employee_id', employeeId)
    return unwrap<any[]>(x)
  } })
  const [edit, setEdit] = useState<any | null>(null)
  const canSetForOthers = can('performance.manage') || access?.is_manager
  const totalWeight = (emp: string) => (q.data ?? []).filter((g) => g.employee_id === emp && g.status !== 'dropped').reduce((a, g) => a + Number(g.weight), 0)
  return (
    <div>
      {!mineOnly && <PageHeader title="Employee goals" description="Weighted goals per cycle. Weights for each employee should add up to 100%." actions={<Button onClick={() => setEdit({ employee_id: employeeId, weight: 20, progress: 0, status: 'active' })}><Plus /> New goal</Button>} />}
      {mineOnly && <div className="mb-3 flex justify-end"><Button onClick={() => setEdit({ employee_id: employeeId, weight: 20, progress: 0, status: 'active' })}><Plus /> New goal</Button></div>}
      <DataTable rows={q.data} loading={q.isLoading || cycles.isLoading} error={q.error} onRowClick={setEdit} exportName="Goals" columns={[
        ...(!mineOnly ? [{ key: 'emp', header: 'Employee', value: (r: any) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r: any) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} sub={`Total weight ${totalWeight(r.employee_id)}%`} /> } as Column<any>] : []),
        { key: 'title', header: 'Goal', cell: (r) => <div><div className="font-medium">{r.title}</div>{r.target && <div className="text-xs text-muted">Target: {r.target}</div>}</div>, value: (r) => r.title },
        { key: 'kpi', header: 'KPI', value: (r) => r.performance_kpis?.name, hideOnMobile: true }, { key: 'weight', header: 'Weight', value: (r) => Number(r.weight), cell: (r) => `${r.weight}%` },
        { key: 'progress', header: 'Progress', value: (r) => r.progress, cell: (r) => <div className="flex w-36 items-center gap-2"><Progress value={r.progress} tone={r.progress >= 100 ? 'success' : 'primary'} /><span className="text-xs tnum">{r.progress}%</span></div> },
        { key: 'due_date', header: 'Due', cell: (r) => fmtDate(r.due_date), hideOnMobile: true }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} toolbar={<Select value={cy ?? ''} onChange={(e) => setCycle(e.target.value)} className="w-auto" aria-label="Cycle">{(cycles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>} emptyTitle="No goals in this cycle" />
      {edit && <GoalDialog goal={edit} cycle={cy!} canPickEmployee={!!canSetForOthers && !mineOnly} onClose={() => setEdit(null)} />}
    </div>
  )
}

function GoalDialog({ goal, cycle, canPickEmployee, onClose }: { goal: any; cycle: string; canPickEmployee: boolean; onClose: () => void }) {
  const [v, setV] = useState<any>({ title: '', description: '', target: '', due_date: '', kpi_id: null, ...goal })
  const kpis = useLookup<any>('performance_kpis', 'id, name, default_weight', 'name', (q) => q.eq('is_active', true))
  const save = useAction(() => {
    const p = { cycle_id: cycle, employee_id: v.employee_id, title: v.title, description: v.description || null, target: v.target || null, weight: Number(v.weight), progress: Number(v.progress), status: v.status, due_date: v.due_date || null, kpi_id: v.kpi_id || null }
    return goal.id ? unwrap(db.from('performance_goals').update(p).eq('id', goal.id).select('id')) : unwrap(db.from('performance_goals').insert(p).select('id'))
  }, { success: 'Goal saved', invalidate: [['performance']], onSuccess: onClose })
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={goal.id ? 'Edit goal' : 'New goal'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!v.title || !v.employee_id} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {canPickEmployee && <Field label="Employee" required className="sm:col-span-2"><EmployeePicker value={v.employee_id} onChange={(id) => setV({ ...v, employee_id: id })} /></Field>}
        <Field label="Goal" required className="sm:col-span-2"><Input value={v.title} onChange={set('title')} /></Field>
        <Field label="Target / measure" className="sm:col-span-2"><Input value={v.target ?? ''} onChange={set('target')} /></Field>
        <Field label="Linked KPI"><Select value={v.kpi_id ?? ''} onChange={set('kpi_id')}><option value="">None</option>{(kpis.data ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select></Field>
        <Field label="Weight (%)" required><Input type="number" min="1" max="100" value={v.weight} onChange={set('weight')} /></Field>
        <Field label={`Progress: ${v.progress}%`}><input type="range" min={0} max={100} step={5} value={v.progress} onChange={set('progress')} className="w-full accent-[rgb(var(--primary))]" /></Field>
        <Field label="Status"><Select value={v.status} onChange={set('status')}>{['draft', 'active', 'completed', 'dropped'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
        <Field label="Due date"><Input type="date" value={v.due_date ?? ''} onChange={set('due_date')} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description ?? ''} onChange={set('description')} /></Field>
      </div>
    </Dialog>
  )
}

export const KpisPage = () => <CrudPage cfg={{
  title: 'KPI library', description: 'Reusable key performance indicators by department or designation. Link goals to KPIs for consistent measurement.',
  table: 'performance_kpis', select: '*, departments(name), designations(name)', permission: 'performance.manage', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
  columns: [{ key: 'name', header: 'KPI' }, { key: 'dep', header: 'Department', value: (r) => r.departments?.name ?? 'All' }, { key: 'des', header: 'Designation', value: (r) => r.designations?.name ?? 'All' },
    { key: 'target', header: 'Target', value: (r) => [r.target_value, r.unit].filter(Boolean).join(' ') }, { key: 'default_weight', header: 'Default weight', value: (r) => `${r.default_weight}%` }],
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'department_id', label: 'Department', type: 'lookup', lookup: { table: 'departments' } },
    { name: 'designation_id', label: 'Designation', type: 'lookup', lookup: { table: 'designations' } }, { name: 'unit', label: 'Unit', type: 'text' }, { name: 'target_value', label: 'Target', type: 'text' },
    { name: 'default_weight', label: 'Default weight (%)', type: 'number', min: 1, max: 100, default: 10, required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
}} />

export function ReviewsPage() {
  const cycles = useCycles()
  const [cycle, setCycle] = useState('')
  const [stage, setStage] = useState('')
  const cy = cycle || (cycles.data ?? []).slice(-1)[0]?.id
  const q = useQuery({ queryKey: ['performance', 'reg', cy, stage], enabled: !!cy, queryFn: () => { let x = db.from('v_appraisal_register').select('*').eq('cycle_id', cy).order('employee_name'); if (stage) x = x.eq('stage', stage); return unwrap<any[]>(x) } })
  return (
    <div>
      <PageHeader title="Performance reviews" description="Every review stage for the selected cycle." />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Performance reviews" columns={[
        { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} sub={r.department_name} /> }, { key: 'stage', header: 'Stage', cell: (r) => <Badge tone="primary">{titleCase(r.stage)}</Badge>, value: (r) => r.stage },
        { key: 'weighted_score', header: 'Weighted score', className: 'tnum' }, { key: 'overall_rating', header: 'Overall', className: 'tnum' }, { key: 'submitted_at', header: 'Submitted', cell: (r) => fmtDate(r.submitted_at) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} toolbar={<>
        <Select value={cy ?? ''} onChange={(e) => setCycle(e.target.value)} className="w-auto" aria-label="Cycle">{(cycles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-auto" aria-label="Stage"><option value="">All stages</option><option value="self">Self</option><option value="manager">Manager</option><option value="hr">HR</option></Select>
      </>} />
    </div>
  )
}

export function ReviewStagePage({ stage }: { stage: 'self' | 'manager' | 'hr' }) {
  const { employeeId } = useMe()
  const q = useQuery({ queryKey: ['performance', 'stage', stage, employeeId], queryFn: () => {
    let x = db.from('v_appraisal_register').select('*').eq('stage', stage).order('status', { ascending: false })
    if (stage === 'self') x = x.eq('employee_id', employeeId)
    else if (stage === 'manager') x = x.neq('employee_id', employeeId)
    return unwrap<any[]>(x)
  } })
  const [open, setOpen] = useState<any | null>(null)
  const meta = { self: ['Self assessment', 'Rate your own progress on each goal. Your manager sees your ratings when they review.'], manager: ['Manager assessment', 'Review your team. Self assessments are shown alongside.'], hr: ['HR assessment', 'Final HR review. Submitting sends the result for approval.'] }[stage]
  return (
    <div>
      <PageHeader title={meta[0]} description={meta[1]} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={setOpen} columns={[
        { key: 'cycle_name', header: 'Cycle' }, ...(stage !== 'self' ? [{ key: 'employee_name', header: 'Employee', cell: (r: any) => <EmployeeCell name={r.employee_name} sub={r.department_name} /> } as Column<any>] : []),
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'overall_rating', header: 'Rating', className: 'tnum' }, { key: 'submitted_at', header: 'Submitted', cell: (r) => fmtDate(r.submitted_at) },
        { key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => <Button size="sm" variant={r.status === 'pending' ? 'primary' : 'secondary'}>{r.status === 'pending' ? 'Start review' : 'View'}</Button> },
      ]} emptyTitle="No reviews for you here" emptyDescription={stage === 'self' ? 'Reviews open when HR launches an appraisal cycle.' : undefined} />
      {open && <ReviewForm review={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ReviewForm({ review, onClose }: { review: any; onClose: () => void }) {
  const goals = useQuery({ queryKey: ['performance', 'review-goals', review.id], queryFn: () => unwrap<any[]>(db.from('performance_goals').select('*').eq('cycle_id', review.cycle_id).eq('employee_id', review.employee_id).neq('status', 'dropped').order('created_at')) })
  const others = useQuery({ queryKey: ['performance', 'review-others', review.id], queryFn: () => unwrap<any[]>(db.from('appraisal_reviews').select('id, stage, status, overall_rating, strengths, improvements, comments, appraisal_ratings(goal_id, rating, comment)').eq('cycle_id', review.cycle_id).eq('employee_id', review.employee_id).neq('id', review.id)) })
  const levels = useQuery({ queryKey: ['performance', 'levels', review.cycle_id], queryFn: async () => { const c = await unwrap<any>(db.from('appraisal_cycles').select('rating_scale_id').eq('id', review.cycle_id).single()); return unwrap<any[]>(db.from('rating_scale_levels').select('*').eq('scale_id', c.rating_scale_id).order('value')) } })
  const [ratings, setRatings] = useState<Record<string, { rating: number; comment: string }>>({})
  const [overall, setOverall] = useState<number | ''>(''); const [strengths, setStrengths] = useState(review.strengths ?? ''); const [improve, setImprove] = useState(review.improvements ?? ''); const [comments, setComments] = useState(review.comments ?? '')
  const readOnly = review.status === 'submitted'
  const weighted = useMemo(() => { const gs = goals.data ?? []; const w = gs.reduce((a, g) => a + (ratings[g.id] ? Number(g.weight) : 0), 0); const n = gs.filter((g) => ratings[g.id]).length; if (n < gs.length) return `— (${n} of ${gs.length} goals rated)`; return w ? (gs.reduce((a, g) => a + (ratings[g.id]?.rating ?? 0) * Number(g.weight), 0) / w).toFixed(2) : '—' }, [goals.data, ratings])
  const submit = useAction(() => rpc('submit_appraisal_review', { p_review: review.id, p_ratings: Object.entries(ratings).map(([goal_id, r]) => ({ goal_id, rating: r.rating, comment: r.comment })), p_overall: overall || null, p_strengths: strengths, p_improvements: improve, p_comments: comments }), {
    success: 'Review submitted', invalidate: [['performance']], onSuccess: onClose,
  })
  const prior = (others.data ?? []).filter((o) => o.status === 'submitted')
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`${titleCase(review.stage)} review · ${review.employee_name}`} description={review.cycle_name}
      footer={!readOnly && <><span className="mr-auto text-sm text-muted">Weighted score: <b className="tnum text-text">{weighted}</b></span><Button loading={submit.isPending} disabled={Object.keys(ratings).length < (goals.data ?? []).length} onClick={() => submit.mutate()}>Submit review</Button></>}>
      <QueryView q={goals} empty={{ when: (d) => d.length === 0, title: 'No goals to rate', description: 'Goals must be set for this cycle first.' }}>
        {(gs) => (
          <div className="space-y-4">
            {gs.map((g) => {
              const priorR = prior.map((p) => ({ stage: p.stage, r: p.appraisal_ratings?.find((x: any) => x.goal_id === g.id) })).filter((x) => x.r)
              return (
                <Card key={g.id} className="p-4">
                  <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{g.title}</div><div className="text-xs text-muted">Weight {g.weight}% · progress {g.progress}%{g.target && ` · target: ${g.target}`}</div></div></div>
                  {priorR.length > 0 && <div className="mt-2 flex flex-wrap gap-2 text-xs">{priorR.map((p) => <span key={p.stage} className="rounded bg-raised px-2 py-1">{titleCase(p.stage)}: <b>{p.r.rating}</b>{p.r.comment && ` — ${p.r.comment}`}</span>)}</div>}
                  {!readOnly && <>
                    <div className="mt-3 flex flex-wrap gap-1.5">{(levels.data ?? []).map((l) => (
                      <button key={l.value} type="button" title={l.label} onClick={() => setRatings({ ...ratings, [g.id]: { rating: l.value, comment: ratings[g.id]?.comment ?? '' } })}
                        className={cn('flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs', ratings[g.id]?.rating === l.value ? 'border-primary bg-primary text-primary-fg' : 'border-line hover:bg-raised')}>
                        <Star className="h-3 w-3" />{l.value} <span className="hidden sm:inline">{l.label}</span></button>
                    ))}</div>
                    <Input className="mt-2" placeholder="Comment (optional)" value={ratings[g.id]?.comment ?? ''} onChange={(e) => setRatings({ ...ratings, [g.id]: { rating: ratings[g.id]?.rating ?? 0, comment: e.target.value } })} />
                  </>}
                </Card>
              )
            })}
            {!readOnly ? (
              <div className="space-y-3">
                <Field label="Overall rating (defaults to weighted score)"><Select value={overall} onChange={(e) => setOverall(e.target.value ? Number(e.target.value) : '')}><option value="">Use weighted score</option>{(levels.data ?? []).map((l) => <option key={l.value} value={l.value}>{l.value} — {l.label}</option>)}</Select></Field>
                <Field label="Strengths"><Textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} /></Field>
                <Field label="Areas to improve"><Textarea value={improve} onChange={(e) => setImprove(e.target.value)} /></Field>
                <Field label="Comments"><Textarea value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
              </div>
            ) : (
              <Card className="p-4 text-sm"><div className="mb-2 font-medium">Overall rating: {review.overall_rating ?? '—'}</div>{[['Strengths', review.strengths], ['Areas to improve', review.improvements], ['Comments', review.comments]].map(([k, v]) => v && <p key={k} className="mt-1"><span className="text-muted">{k}:</span> {v}</p>)}</Card>
            )}
          </div>
        )}
      </QueryView>
    </Drawer>
  )
}

export function FeedbackPage() {
  const { employeeId, orgId } = useMe()
  const q = useQuery({ queryKey: ['performance', 'feedback'], queryFn: () => unwrap<any[]>(db.from('performance_feedback').select('*, from:employees!performance_feedback_from_employee_id_fkey(first_name, last_name), to:employees!performance_feedback_to_employee_id_fkey(first_name, last_name)').order('created_at', { ascending: false })) })
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<string | null>(null); const [type, setType] = useState('praise'); const [vis, setVis] = useState('private'); const [msg, setMsg] = useState('')
  const send = useAction(() => unwrap(db.from('performance_feedback').insert({ organisation_id: orgId, from_employee_id: employeeId, to_employee_id: to, feedback_type: type, visibility: vis, message: msg }).select('id')), { success: 'Feedback sent', invalidate: [['performance', 'feedback']], onSuccess: () => { setOpen(false); setMsg('') } })
  const rows = (q.data ?? []).map((f) => ({ ...f, direction: f.to_employee_id === employeeId ? 'Received' : f.from_employee_id === employeeId ? 'Given' : 'Team' }))
  return (
    <div>
      <PageHeader title="Feedback" description="Continuous feedback between colleagues. 'Manager' visibility lets the recipient’s manager see it too." actions={<Button onClick={() => setOpen(true)}><MessageSquarePlus /> Give feedback</Button>} />
      <DataTable rows={rows} loading={q.isLoading} error={q.error} columns={[
        { key: 'direction', header: '', cell: (r) => <Badge tone={r.direction === 'Received' ? 'primary' : 'neutral'}>{r.direction}</Badge> },
        { key: 'from', header: 'From', value: (r) => `${r.from?.first_name} ${r.from?.last_name}` }, { key: 'to', header: 'To', value: (r) => `${r.to?.first_name} ${r.to?.last_name}` },
        { key: 'feedback_type', header: 'Type', value: (r) => titleCase(r.feedback_type) }, { key: 'message', header: 'Message', cell: (r) => <span className="line-clamp-2 max-w-md">{r.message}</span> },
        { key: 'created_at', header: 'When', cell: (r) => ago(r.created_at) },
      ]} emptyTitle="No feedback yet" />
      <Dialog open={open} onOpenChange={setOpen} title="Give feedback" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={send.isPending} disabled={!to || !msg.trim()} onClick={() => send.mutate()}>Send</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="To" required className="sm:col-span-2"><EmployeePicker value={to} onChange={setTo} filter={(e: any) => e.id !== employeeId} /></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="praise">Praise</option><option value="constructive">Constructive</option><option value="request">Request</option></Select></Field>
          <Field label="Visible to"><Select value={vis} onChange={(e) => setVis(e.target.value)}><option value="private">Recipient only</option><option value="manager">Recipient and their manager</option></Select></Field>
          <Field label="Message" required className="sm:col-span-2"><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function RatingScalesPage() {
  const [scale, setScale] = useState<any | null>(null)
  return (
    <div className="space-y-5">
      <CrudPage cfg={{
        title: 'Rating scales', description: 'Configure rating levels used in reviews. The default five-point scale is created for every organisation.',
        table: 'rating_scales', permission: 'performance.manage', orderBy: { column: 'name' }, remove: 'delete',
        columns: [{ key: 'name', header: 'Scale' }, { key: 'is_default', header: 'Default', value: (r) => (r.is_default ? 'Yes' : '') }],
        rowActions: (r) => <Button size="sm" variant="ghost" onClick={() => setScale(r)}>Levels</Button>,
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'is_default', label: 'Default scale', type: 'switch' }],
      }} />
      {scale && <Drawer open onOpenChange={(o) => !o && setScale(null)} title={`${scale.name} — levels`}>
        <CrudPage cfg={{
          title: 'Levels', embedded: true, table: 'rating_scale_levels', orgScoped: false, permission: 'performance.manage', queryKey: ['crud', 'rating_scale_levels', scale.id],
          filter: (q) => q.eq('scale_id', scale.id), orderBy: { column: 'value' }, remove: 'delete', transform: (v) => ({ ...v, scale_id: scale.id }),
          columns: [{ key: 'value', header: 'Value', className: 'tnum' }, { key: 'label', header: 'Label' }, { key: 'description', header: 'Description' }],
          fields: [{ name: 'value', label: 'Value', type: 'number', required: true, min: 1, max: 10 }, { name: 'label', label: 'Label', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'textarea' }],
        }} />
      </Drawer>}
    </div>
  )
}

export function AppraisalHistoryPage({ employeeId: forEmp }: { employeeId?: string }) {
  const { employeeId } = useMe()
  const emp = forEmp ?? employeeId
  const finals = useQuery({ queryKey: ['performance', 'history', emp], queryFn: () => unwrap<any[]>(db.from('appraisal_finals').select('*, appraisal_cycles(name, period_start, period_end)').eq('employee_id', emp)) })
  const reviews = useQuery({ queryKey: ['performance', 'history-reviews', emp], queryFn: () => unwrap<any[]>(db.from('v_appraisal_register').select('*').eq('employee_id', emp).eq('status', 'submitted').order('submitted_at', { ascending: false })) })
  return (
    <div className="space-y-5">
      {!forEmp && <PageHeader title="Appraisal history" description="Your performance timeline: results, reviews and development plans." />}
      <Card><CardHeader title="Timeline" />
        <QueryView q={reviews} empty={{ when: (d) => d.length === 0 && (finals.data ?? []).length === 0, title: 'No completed reviews yet' }}>
          {(rs) => (
            <ol className="relative ml-8 border-l border-line py-4">
              {(finals.data ?? []).map((f) => <li key={f.id} className="mb-5 ml-5"><span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-success" /><div className="text-sm font-medium">{f.appraisal_cycles?.name} — final rating {f.final_rating ?? '—'}</div><div className="text-xs text-muted"><StatusBadge status={f.status} /> {fmtDate(f.approved_at)}</div></li>)}
              {rs.map((r) => <li key={r.id} className="mb-5 ml-5"><span className="absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-primary" /><div className="text-sm"><b>{titleCase(r.stage)} review</b> · {r.cycle_name} · rating {r.overall_rating ?? '—'} (score {r.weighted_score ?? '—'})</div><div className="text-xs text-muted">{fmtDate(r.submitted_at)}</div>{r.strengths && <p className="mt-1 text-sm text-muted">{r.strengths}</p>}</li>)}
            </ol>
          )}
        </QueryView>
      </Card>
      <CrudPage cfg={{
        title: 'Development plans', embedded: true, table: 'development_plans', orgScoped: false, permission: ['performance.manage', 'performance.view_team', 'attendance.clock'], queryKey: ['performance', 'dev', emp],
        filter: (q) => q.eq('employee_id', emp), remove: 'delete', transform: (v) => ({ ...v, employee_id: emp }),
        columns: [{ key: 'focus_area', header: 'Focus area' }, { key: 'actions', header: 'Actions' }, { key: 'due_date', header: 'Due', cell: (r) => fmtDate(r.due_date) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
        fields: [{ name: 'focus_area', label: 'Focus area', type: 'text', required: true }, { name: 'actions', label: 'Actions', type: 'textarea', required: true }, { name: 'due_date', label: 'Due', type: 'date' },
          { name: 'status', label: 'Status', type: 'select', required: true, default: 'open', options: ['open', 'in_progress', 'done'].map((v) => ({ value: v, label: titleCase(v) })) }],
      }} />
    </div>
  )
}
