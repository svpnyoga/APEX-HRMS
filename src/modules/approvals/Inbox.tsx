import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, X, Clock3 } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAction } from '@/hooks/data'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/page'
import { StatusBadge } from '@/components/common/status'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { ago, fmtDateTime, money, titleCase } from '@/lib/utils'

export const ENTITY_LABEL: Record<string, string> = {
  leave: 'Leave', attendance_regularisation: 'Regularisation', attendance_permission: 'Permission', expense_claim: 'Claim',
  payroll_run: 'Payroll', salary_revision: 'Salary revision', leave_encashment: 'Encashment', appraisal: 'Appraisal', onboarding: 'Onboarding', resignation: 'Resignation',
}

function ApprovalHistory({ requestId }: { requestId: string }) {
  const q = useQuery({
    queryKey: ['approval-history', requestId],
    queryFn: () => unwrap<any[]>(db.from('approval_tasks').select('id, step_order, step_name, status, comment, acted_at, approver_user_id, user_profiles!approval_tasks_approver_user_id_fkey(full_name)').eq('request_id', requestId).order('step_order').order('created_at')),
  })
  if (!q.data?.length) return null
  return (
    <ol className="mt-3 space-y-2 border-l border-line pl-4">
      {q.data.map((t) => (
        <li key={t.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-line" />
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.step_name}</span><span className="text-muted">{t.user_profiles?.full_name}</span><StatusBadge status={t.status} /></div>
          {t.comment && <p className="text-muted">“{t.comment}”</p>}
          {t.acted_at && <p className="text-xs text-subtle">{fmtDateTime(t.acted_at)}</p>}
        </li>
      ))}
    </ol>
  )
}

export function ApprovalsInbox({ entityTypes, title = 'Approvals', description, embedded }: { entityTypes?: string[]; title?: string; description?: string; embedded?: boolean }) {
  const [tab, setTab] = useState('pending')
  const [acting, setActing] = useState<{ row: any; action: 'approve' | 'reject' } | null>(null)
  const [comment, setComment] = useState('')
  const q = useQuery({
    queryKey: ['approvals', entityTypes?.join(',')],
    queryFn: async () => {
      let query = db.from('my_approval_tasks').select('*').order('assigned_at', { ascending: false }).limit(500)
      if (entityTypes) query = query.in('entity_type', entityTypes)
      return unwrap<any[]>(query)
    },
  })
  const act = useAction(({ id, action, comment }: { id: string; action: string; comment: string }) => rpc<string>('act_on_approval', { p_task: id, p_action: action, p_comment: comment || null }), {
    success: (r) => (r === 'approved' ? 'Approved — request completed' : r === 'rejected' ? 'Rejected' : r === 'waiting' ? 'Recorded — waiting for other approvers' : 'Approved — sent to next step'),
    invalidate: [['approvals'], ['dashboard'], ['leave'], ['claims'], ['attendance'], ['payroll']],
    onSuccess: () => { setActing(null); setComment('') },
  })

  const rows = q.data ?? []
  const pending = rows.filter((r) => r.task_status === 'pending' && r.request_status === 'pending')
  const history = rows.filter((r) => r.task_status !== 'pending' || r.request_status !== 'pending')

  const cols: Column<any>[] = [
    { key: 'title', header: 'Request', cell: (r) => (
      <div className="min-w-0"><div className="font-medium">{r.title}</div>{r.summary && <div className="line-clamp-1 text-xs text-muted">{r.summary}</div>}</div>
    ) },
    { key: 'entity_type', header: 'Type', value: (r) => ENTITY_LABEL[r.entity_type] ?? titleCase(r.entity_type), cell: (r) => <Badge>{ENTITY_LABEL[r.entity_type] ?? titleCase(r.entity_type)}</Badge> },
    { key: 'requester_name', header: 'Requested by', hideOnMobile: true },
    { key: 'step_name', header: 'Your step', hideOnMobile: true },
    { key: 'amount', header: 'Amount', value: (r) => r.amount, cell: (r) => (r.amount ? money(r.amount) : '—'), hideOnMobile: true },
    { key: 'submitted_at', header: 'Submitted', value: (r) => r.submitted_at, cell: (r) => <span title={fmtDateTime(r.submitted_at)}>{ago(r.submitted_at)}</span> },
  ]
  const pendingCols: Column<any>[] = [...cols,
    { key: 'due_at', header: 'Due', hideOnMobile: true, cell: (r) => (r.due_at ? <span className={new Date(r.due_at) < new Date() ? 'text-danger' : 'text-muted'}><Clock3 className="mr-1 inline h-3.5 w-3.5" />{ago(r.due_at)}</span> : '—') },
    { key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" onClick={() => setActing({ row: r, action: 'reject' })}><X /> Reject</Button>
        <Button size="sm" variant="success" onClick={() => setActing({ row: r, action: 'approve' })}><Check /> Approve</Button>
      </div>
    ) },
  ]
  const historyCols: Column<any>[] = [...cols, { key: 'task_status', header: 'Your decision', cell: (r) => <StatusBadge status={r.task_status} /> },
    { key: 'request_status', header: 'Outcome', cell: (r) => <StatusBadge status={r.request_status} /> }]

  return (
    <div>
      {!embedded && <PageHeader title={title} description={description ?? 'Requests waiting for your decision. Rejections need a reason, which the requester will see.'} />}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">Waiting for you {pending.length > 0 && <Badge tone="warning" className="ml-1.5">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="history">Decided</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <DataTable rows={pending} columns={pendingCols} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle="No approvals waiting" emptyDescription="When someone needs your decision, it shows up here and in your notifications."
            onRowClick={(r) => setActing({ row: r, action: 'approve' })} rowKey="task_id" />
        </TabsContent>
        <TabsContent value="history">
          <DataTable rows={history} columns={historyCols} loading={q.isLoading} error={q.error} rowKey="task_id" exportName="Approval history" emptyTitle="No decisions yet" />
        </TabsContent>
      </Tabs>

      <Dialog open={!!acting} onOpenChange={(o) => !o && setActing(null)} title={acting?.action === 'reject' ? 'Reject request' : 'Approve request'} description={acting?.row.title}
        footer={<>
          <Button variant="secondary" onClick={() => setActing(null)}>Cancel</Button>
          {acting?.action === 'approve' && <Button variant="ghost" onClick={() => setActing({ ...acting, action: 'reject' })}>Reject instead</Button>}
          <Button variant={acting?.action === 'reject' ? 'danger' : 'success'} loading={act.isPending} disabled={acting?.action === 'reject' && !comment.trim()}
            onClick={() => acting && act.mutate({ id: acting.row.task_id, action: acting.action, comment })}>{acting?.action === 'reject' ? 'Reject' : 'Approve'}</Button>
        </>}>
        {acting && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted">Requested by</dt><dd className="font-medium">{acting.row.requester_name}</dd></div>
              <div><dt className="text-muted">Type</dt><dd>{ENTITY_LABEL[acting.row.entity_type]}</dd></div>
              {acting.row.amount && <div><dt className="text-muted">Amount</dt><dd className="figure text-lg">{money(acting.row.amount)}</dd></div>}
              <div><dt className="text-muted">Your step</dt><dd>{acting.row.step_name}</dd></div>
              {acting.row.summary && <div className="col-span-2"><dt className="text-muted">Details</dt><dd>{acting.row.summary}</dd></div>}
            </dl>
            <ApprovalHistory requestId={acting.row.request_id} />
            <Field label={acting.action === 'reject' ? 'Reason for rejection' : 'Comment (optional)'} required={acting.action === 'reject'}>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={acting.action === 'reject' ? 'The requester will see this' : ''} />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** Small "my requests" list with live approval status, used in self-service pages. */
export function MyRequestStatus({ entityType, entityId }: { entityType: string; entityId: string }) {
  const q = useQuery({
    queryKey: ['req-status', entityType, entityId],
    queryFn: () => unwrap<any>(db.from('approval_requests').select('id, status, current_step').eq('entity_type', entityType).eq('entity_id', entityId).maybeSingle()),
  })
  if (!q.data) return null
  return <ApprovalHistory requestId={q.data.id} />
}
