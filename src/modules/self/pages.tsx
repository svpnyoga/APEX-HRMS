import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Clock, Download, Receipt, ShieldCheck, Megaphone, GraduationCap, Wallet, ChevronRight, Inbox, LogOut, KeyRound } from 'lucide-react'
import { db, unwrap } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useRpc } from '@/hooks/data'
import { PageHeader, QueryView, StatStrip, EmptyState } from '@/components/common/page'
import { DataTable } from '@/components/common/DataTable'
import { StatusBadge } from '@/components/common/status'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Avatar, Badge, Card, CardHeader, Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { fmtDate, fmtTime, minutes, money, titleCase } from '@/lib/utils'
import { ClockPanel } from '@/modules/attendance/clock'
import { AttendanceCalendarView, RegularisationForm } from '@/modules/attendance/pages'
import { ApplyLeaveForm, leaveCols, useCancelLeave, useLeaveRegister } from '@/modules/leave/pages'
import { MyClaimsPage } from '@/modules/claims/pages'
import { PayslipsPage } from '@/modules/payroll/pages'
import { MyLearning } from '@/modules/learning/pages'
import { GoalsPage, AppraisalHistoryPage, ReviewStagePage } from '@/modules/performance/pages'
import { FaceSelfCard } from './face-self'
import { ApprovalsInbox, MyRequestStatus } from '@/modules/approvals/Inbox'
import { DocumentsList } from '@/modules/employees/pages'
import { VisitControl, VisitsPage } from '@/modules/field/pages'
import { ResignDialog } from '@/modules/lifecycle/pages'
import { Celebrations } from '@/modules/dashboard/pages'
import { ConsentDialog } from './consent'

export function EssHome() {
  const { access } = useAuth()
  const { name } = useMe()
  const home = useRpc<any>(['my-home'], 'my_home', undefined, !!access?.employee_id)
  const ann = useQuery({ queryKey: ['engagement', 'feed', 'home'], queryFn: () => unwrap<any[]>(db.from('my_announcements').select('id, title, publish_at, priority, read_at').order('publish_at', { ascending: false }).limit(4)) })
  const h = home.data
  const hour = new Date().getHours()
  if (!access?.employee_id) return <EmptyState title="Your login is not linked to an employee record" description="Ask HR to link your account to your employee profile." />
  return (
    <div className="space-y-5">
      <div><h1 className="text-[22px] font-semibold">Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {name.split(' ')[0]}</h1><p className="text-sm text-muted">{fmtDate(new Date(), 'EEEE, d MMMM')}</p></div>
      <ClockPanel />
      <QueryView q={home}>{() => (
        <StatStrip items={[
          { label: 'Leave available', value: (h.balances ?? []).filter((b: any) => b.accrues).reduce((a: number, b: any) => a + Number(b.available), 0), hint: (h.balances ?? []).filter((b: any) => b.accrues).map((b: any) => `${b.code} ${Number(b.available)}`).join(' · ') || 'No accruing leave types', to: '/me/leave' },
          { label: 'Latest payslip', value: h.latest_payslip ? money(h.latest_payslip.net_pay) : '—', hint: h.latest_payslip ? fmtDate(h.latest_payslip.period_month, 'MMMM yyyy') : 'Not yet published', to: '/me/payslips' },
          { label: 'Claims pending', value: h.claims?.pending ?? 0, hint: money(h.claims?.pending_amount), to: '/me/claims' },
          { label: 'Pending tasks', value: h.pending_tasks ?? 0, tone: h.pending_tasks ? 'warning' : 'default', to: access?.is_manager ? '/me/approvals' : '/me/performance' },
          { label: 'Learning', value: `${h.learning?.avg_progress ?? 0}%`, hint: `${h.learning?.completed ?? 0}/${h.learning?.enrolled ?? 0} completed${h.learning?.due_soon ? ` · ${h.learning.due_soon} due soon` : ''}`, to: '/me/learning' },
        ]} />
      )}</QueryView>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader title="Attendance this month" actions={<Link to="/me/attendance" className="text-sm text-primary hover:underline">Details</Link>} />
          <div className="p-3"><AttendanceCalendarView employeeId={access.employee_id} compact /></div></Card>
        <div className="space-y-5">
          <Card><CardHeader title="Quick actions" />
            <div className="grid grid-cols-2 gap-2 p-4">
              {[{ to: '/me/leave', icon: CalendarPlus, label: 'Apply leave' }, { to: '/me/claims', icon: Receipt, label: 'Submit claim' }, { to: '/me/payslips', icon: Wallet, label: 'Payslips' }, { to: '/me/attendance', icon: Clock, label: 'Fix attendance' }].map((a) => (
                <Link key={a.to + a.label} to={a.to} className="flex flex-col items-center gap-1.5 rounded-lg border border-line p-3 text-center text-sm hover:border-primary/40 hover:bg-raised"><a.icon className="h-5 w-5 text-primary" />{a.label}</Link>
              ))}
            </div>
          </Card>
          <Card><CardHeader title="Upcoming holidays" />
            <ul className="divide-y divide-line">{(h?.holidays ?? []).map((x: any) => <li key={x.date} className="flex justify-between px-5 py-2 text-sm"><span>{x.name}</span><span className="text-muted">{fmtDate(x.date, 'EEE, dd MMM')}</span></li>)}
              {(h?.holidays ?? []).length === 0 && <li className="px-5 py-4 text-sm text-muted">None scheduled</li>}</ul>
          </Card>
          <Card><CardHeader title="Announcements" actions={<Link to="/me/announcements" className="text-sm text-primary hover:underline">All</Link>} />
            <ul className="divide-y divide-line">{(ann.data ?? []).map((a) => <li key={a.id}><Link to="/me/announcements" className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-raised">{!a.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}<span className="flex-1 truncate">{a.title}</span><ChevronRight className="h-4 w-4 text-subtle" /></Link></li>)}
              {(ann.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-muted">Nothing new</li>}</ul>
          </Card>
        </div>
      </div>
      <Celebrations />
    </div>
  )
}

export function EssAttendance() {
  const { access } = useAuth()
  const [reg, setReg] = useState(false)
  const reqs = useQuery({ queryKey: ['attendance', 'my-reqs'], queryFn: () => unwrap<any[]>(db.from('attendance_regularisation').select('*').eq('employee_id', access?.employee_id).order('created_at', { ascending: false })) })
  const isField = useQuery({ queryKey: ['me', 'field'], queryFn: async () => (await db.from('employee_directory').select('is_field_employee').eq('id', access?.employee_id).single()).data?.is_field_employee })
  return (
    <div className="space-y-5">
      <PageHeader title="My attendance" actions={<Button variant="secondary" onClick={() => setReg(true)}>Request correction or permission</Button>} />
      <ClockPanel />
      {isField.data && <VisitsPage mine />}
      <AttendanceCalendarView employeeId={access!.employee_id!} />
      <Card><CardHeader title="My correction requests" /><div className="p-3"><DataTable rows={reqs.data} loading={reqs.isLoading} searchable={false} columns={[
        { key: 'work_date', header: 'Date', cell: (r) => fmtDate(r.work_date) }, { key: 'times', header: 'Requested', value: (r) => `${fmtTime(r.requested_in)} – ${fmtTime(r.requested_out)}` },
        { key: 'reason', header: 'Reason' }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'decision_comment', header: 'Comment' },
      ]} emptyTitle="No requests" /></div></Card>
      <Dialog open={reg} onOpenChange={setReg} title="Attendance request"><RegularisationForm onDone={() => setReg(false)} /></Dialog>
    </div>
  )
}

export function EssLeave() {
  const { employeeId } = useMe()
  const mine = useLeaveRegister((q) => q.eq('employee_id', employeeId), `mine-${employeeId}`)
  const cancel = useCancelLeave()
  const [hist, setHist] = useState<any | null>(null)
  return (
    <div className="space-y-5">
      <PageHeader title="Leave" />
      <Card className="p-5"><ApplyLeaveForm /></Card>
      <Card><CardHeader title="My applications" /><div className="p-3"><DataTable rows={mine.data} columns={leaveCols(false, cancel)} loading={mine.isLoading} searchable={false} emptyTitle="No applications yet" onRowClick={setHist} /></div></Card>
      <Dialog open={!!hist} onOpenChange={(o) => !o && setHist(null)} title="Approval history" description={hist ? `${hist.leave_type_name} · ${fmtDate(hist.start_date)}` : ''}>{hist && <MyRequestStatus entityType="leave" entityId={hist.id} />}</Dialog>
    </div>
  )
}

export const EssClaims = () => <div><PageHeader title="My claims" /><MyClaimsPage embedded /></div>
export const EssPayslips = () => <div><PageHeader title="My payslips" description="Download PDF payslips once payroll is published." /><PayslipsPage mine /></div>
export const EssLearning = () => <MyLearning />
export function EssPerformance() {
  return (
    <div><PageHeader title="My performance" />
      <Tabs defaultValue="goals"><TabsList><TabsTrigger value="goals">Goals</TabsTrigger><TabsTrigger value="self">Self assessment</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="goals"><GoalsPage mineOnly /></TabsContent><TabsContent value="self"><ReviewStagePage stage="self" /></TabsContent><TabsContent value="history"><AppraisalHistoryPage /></TabsContent></Tabs>
    </div>
  )
}
export const EssApprovals = () => <ApprovalsInbox title="Team approvals" />

export function EssProfile() {
  const { access, profile } = useAuth()
  const home = useRpc<any>(['my-home'], 'my_home', undefined, !!access?.employee_id)
  const emp = useQuery({ queryKey: ['employee', access?.employee_id], enabled: !!access?.employee_id, queryFn: () => unwrap<any>(db.from('employees').select('*, departments!employees_department_id_fkey(name), designations(name), locations(name), manager:reporting_manager_id(first_name, last_name)').eq('id', access!.employee_id).single()) })
  const [consent, setConsent] = useState<'biometric' | 'location' | null>(null)
  const [pw, setPw] = useState(false)
  const e = emp.data
  return (
    <div className="space-y-5">
      <PageHeader title="My profile" />
      <Card className="flex items-center gap-4 p-5">
        <Avatar name={profile?.full_name} src={e?.photo_url} size={64} />
        <div><div className="text-lg font-semibold">{profile?.full_name}</div><div className="text-sm text-muted">{e?.designations?.name} · {e?.departments?.name}</div><div className="mt-1 text-xs text-subtle">{e?.employee_code} · joined {fmtDate(e?.date_of_joining)} · reports to {e?.manager ? `${e.manager.first_name} ${e.manager.last_name}` : '—'}</div></div>
      </Card>
      <FaceSelfCard consent={!!home.data?.face?.consent} onNeedConsent={() => setConsent('biometric')} />
      <Card><CardHeader title="Privacy & consent" description="You can change these at any time. Withdrawing biometric consent deletes your face templates immediately." />
        <div className="divide-y divide-line">
          {(['biometric', 'location'] as const).map((t) => { const on = t === 'biometric' ? home.data?.face?.consent : home.data?.face?.location_consent; return (
            <div key={t} className="flex items-center justify-between gap-3 px-5 py-3"><div><div className="text-sm font-medium">{t === 'biometric' ? 'Face recognition attendance' : 'Location during work'}</div>
              <div className="text-xs text-muted">{t === 'biometric' ? `Enrolment: ${titleCase(home.data?.face?.status ?? 'not_enrolled')}` : 'Used for site attendance and field visits only'}</div></div>
              <div className="flex items-center gap-2"><Badge tone={on ? 'success' : 'neutral'}>{on ? 'Consented' : 'Not given'}</Badge><Button size="sm" variant="secondary" onClick={() => setConsent(t)}><ShieldCheck /> {on ? 'Review / withdraw' : 'Review'}</Button></div></div>
          ) })}
        </div>
      </Card>
      <Card><CardHeader title="My documents" description="Upload documents for HR verification." /><div className="p-3"><DocumentsList employeeId={access!.employee_id!} /></div></Card>
      <Card className="flex items-center justify-between p-5"><div><div className="text-sm font-medium">Password</div><div className="text-xs text-muted">{profile?.email}</div></div><Button variant="secondary" onClick={() => setPw(true)}><KeyRound /> Change password</Button></Card>
      {consent && <ConsentDialog open onOpenChange={(o) => !o && setConsent(null)} type={consent} onDone={() => home.refetch()} />}
      {pw && <PasswordDialog onClose={() => setPw(false)} />}
    </div>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [a, setA] = useState(''); const [b, setB] = useState('')
  const valid = a.length >= 10 && /[A-Z]/.test(a) && /[0-9]/.test(a) && a === b
  const save = useAction(() => supabase.auth.updateUser({ password: a }).then(({ error }) => { if (error) throw error }), { success: 'Password updated', onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Change password" footer={<Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Update password</Button>}>
      <div className="space-y-4">
        <Field label="New password" hint="At least 10 characters with a capital letter and a number"><Input type="password" value={a} onChange={(e) => setA(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm" error={b && a !== b ? 'Passwords do not match' : undefined}><Input type="password" value={b} onChange={(e) => setB(e.target.value)} autoComplete="new-password" /></Field>
      </div>
    </Dialog>
  )
}

export function EssResignation() {
  const { employeeId } = useMe()
  const q = useQuery({ queryKey: ['offboarding', 'mine'], queryFn: () => unwrap<any[]>(db.from('offboarding_cases').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })) })
  const [open, setOpen] = useState(false)
  const active = (q.data ?? []).find((c) => ['pending_approval', 'approved', 'in_clearance'].includes(c.status))
  return (
    <div className="space-y-5">
      <PageHeader title="Resignation" description="Submitting a resignation starts an approval with your manager and HR." actions={!active && <Button variant="danger" onClick={() => setOpen(true)}><LogOut /> Submit resignation</Button>} />
      <DataTable rows={q.data} loading={q.isLoading} searchable={false} columns={[
        { key: 'resignation_date', header: 'Submitted', cell: (r) => fmtDate(r.resignation_date) }, { key: 'requested_lwd', header: 'Requested last day', cell: (r) => fmtDate(r.requested_lwd) },
        { key: 'approved_lwd', header: 'Approved last day', cell: (r) => fmtDate(r.approved_lwd) }, { key: 'reason', header: 'Reason' }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} emptyTitle="No resignation submitted" />
      {open && <ResignDialog selfId={employeeId} onClose={() => setOpen(false)} />}
    </div>
  )
}
