import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Banknote, ExternalLink, Paperclip, Plus, Send, AlertTriangle, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { uploadFile, openFile, signedUrl } from '@/lib/storage'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip, EmptyState } from '@/components/common/page'
import { EmployeeCell } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { AXIS, ChartCard, GRID, SERIES, TOOLTIP } from '@/components/common/charts'
import { CrudPage } from '@/components/crud/CrudPage'
import { FileDrop } from '@/components/common/upload'
import { Button } from '@/components/ui/button'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader } from '@/components/ui/misc'
import { errorMessage, fmtDate, isoDate, money, sha256Hex, titleCase, moneyShort } from '@/lib/utils'
import { ApprovalsInbox, MyRequestStatus } from '@/modules/approvals/Inbox'

export const useClaims = (filter?: (q: any) => any, key = 'all') => useQuery({
  queryKey: ['claims', key],
  queryFn: async () => { let q: any = db.from('v_claims_register').select('*').order('expense_date', { ascending: false }).limit(3000); if (filter) q = filter(q); return unwrap<any[]>(q) },
})

const claimCols = (withEmp: boolean): Column<any>[] => [
  { key: 'claim_number', header: 'Claim', cell: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{r.claim_number}</div></div>, value: (r) => `${r.claim_number} ${r.title}` },
  ...(withEmp ? [{ key: 'employee_name', header: 'Employee', cell: (r: any) => <EmployeeCell name={r.employee_name} sub={r.department_name} /> } as Column<any>] : []),
  { key: 'category_name', header: 'Category' }, { key: 'expense_date', header: 'Date', cell: (r) => fmtDate(r.expense_date) },
  { key: 'amount', header: 'Amount', value: (r) => Number(r.amount), cell: (r) => <span className="font-medium tnum">{money(r.amount, true)}</span> },
  { key: 'flags', header: '', value: (r) => [r.policy_violation && 'Policy', r.is_possible_duplicate && 'Duplicate?'].filter(Boolean).join(' '), cell: (r) => (
    <div className="flex gap-1">{r.policy_violation && <Badge tone="warning"><AlertTriangle className="h-3 w-3" />Policy</Badge>}{r.is_possible_duplicate && <Badge tone="danger"><Copy className="h-3 w-3" />Duplicate?</Badge>}{r.attachment_count > 0 && <Badge><Paperclip className="h-3 w-3" />{r.attachment_count}</Badge>}</div>
  ) },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
]

export function ClaimsDashboard() {
  const q = useClaims()
  const rows = q.data ?? []
  const month = isoDate().slice(0, 7)
  const byCat = Object.entries(rows.filter((r) => ['approved', 'reimbursed'].includes(r.status)).reduce((a: Record<string, number>, r) => ({ ...a, [r.category_name]: (a[r.category_name] ?? 0) + Number(r.amount) }), {})).map(([name, amount]) => ({ name, amount }))
  return (
    <div className="space-y-5">
      <PageHeader title="Claims dashboard" description="Expense claims across the organisation (or your team)." />
      <StatStrip items={[
        { label: 'Awaiting approval', value: money(rows.filter((r) => r.status === 'submitted').reduce((a, r) => a + Number(r.amount), 0)), hint: `${rows.filter((r) => r.status === 'submitted').length} claims`, tone: 'warning', to: '/claims/approvals' },
        { label: 'Approved, to reimburse', value: money(rows.filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.approved_amount ?? r.amount), 0)), tone: 'primary', to: '/claims/reimbursements' },
        { label: 'Reimbursed this month', value: money(rows.filter((r) => r.status === 'reimbursed' && (r.paid_on ?? '').startsWith(month)).reduce((a, r) => a + Number(r.approved_amount ?? r.amount), 0)), tone: 'success' },
        { label: 'Flagged', value: rows.filter((r) => r.status === 'submitted' && (r.policy_violation || r.is_possible_duplicate)).length, tone: 'danger', hint: 'Policy exceptions or possible duplicates' },
      ]} />
      <ChartCard title="Approved spend by category" height={280}>
        {byCat.length === 0 ? <EmptyState title="No approved claims yet" /> : <ResponsiveContainer><BarChart data={byCat}><CartesianGrid {...GRID} /><XAxis dataKey="name" {...AXIS} /><YAxis {...AXIS} width={60} tickFormatter={moneyShort} /><Tooltip {...TOOLTIP} formatter={(v: any) => money(v)} /><Bar dataKey="amount" fill={SERIES[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>}
      </ChartCard>
      <DataTable rows={rows.slice(0, 200)} columns={claimCols(true)} loading={q.isLoading} error={q.error} exportName="Claims" />
    </div>
  )
}

export function ClaimForm({ onDone, existing }: { onDone?: (id: string) => void; existing?: any }) {
  const { orgId, employeeId } = useMe()
  const cats = useLookup<any>('claim_categories', 'id, name, receipt_required_above', 'name', (q) => q.eq('is_active', true))
  const pols = useLookup<any>('expense_policies', 'category_id, per_claim_limit, monthly_limit, designation_id', 'category_id', (q) => q.eq('is_active', true))
  const [v, setV] = useState<any>({ category_id: '', title: '', description: '', expense_date: isoDate(), amount: '', project_reference: '', justification: '', ...existing })
  const [files, setFiles] = useState<File[]>([])
  // Once the draft row exists, retries (e.g. after "receipt required") must update it, not insert another draft.
  const [savedId, setSavedId] = useState<string | undefined>(existing?.id)
  const cat = (cats.data ?? []).find((c) => c.id === v.category_id)
  const pol = (pols.data ?? []).find((p) => p.category_id === v.category_id)
  const over = pol?.per_claim_limit && Number(v.amount) > Number(pol.per_claim_limit)
  const save = useAction(async (submit: boolean) => {
    const payload = { category_id: v.category_id, title: v.title, description: v.description || null, expense_date: v.expense_date, amount: Number(v.amount), project_reference: v.project_reference || null, justification: v.justification || null }
    let id: string = savedId ?? ''
    if (id) await unwrap(db.from('expense_claims').update(payload).eq('id', id).select('id'))
    else {
      id = (await unwrap<any[]>(db.from('expense_claims').insert({ ...payload, organisation_id: orgId, employee_id: employeeId, status: 'draft' }).select('id')))[0].id
      setSavedId(id)
    }
    for (const f of files) {
      const path = await uploadFile('claim-receipts', orgId, employeeId, f)
      await unwrap(db.from('claim_attachments').insert({ claim_id: id, storage_path: path, file_name: f.name, mime_type: f.type, size_bytes: f.size, sha256: await sha256Hex(f) }).select('id'))
    }
    if (files.length) setFiles([]) // uploaded; a retry must not attach them twice
    if (submit) {
      const r: any = await rpc('submit_claim', { p_claim: id })
      if (r.possible_duplicate) toast.warning('Submitted — flagged as a possible duplicate for your approver to check')
      else if (r.policy_violation) toast.warning(`Submitted with a policy exception: ${r.policy_violation}`)
    }
    return { id, submit }
  }, { success: (r) => (r.submit ? 'Claim submitted for approval' : 'Draft saved'), invalidate: [['claims'], ['my-home']], onSuccess: (r) => onDone?.(r.id) })
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value })
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required><Select value={v.category_id} onChange={set('category_id')}><option value="">Select…</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Expense date" required><Input type="date" value={v.expense_date} max={isoDate()} onChange={set('expense_date')} /></Field>
        <Field label="Title" required className="sm:col-span-2"><Input value={v.title} onChange={set('title')} placeholder="e.g. Cab to Sriperumbudur customer site" /></Field>
        <Field label="Amount (₹)" required hint={pol?.per_claim_limit ? `Policy limit ${money(pol.per_claim_limit)} per claim${pol.monthly_limit ? `, ${money(pol.monthly_limit)} per month` : ''}` : undefined}>
          <Input type="number" min="0" step="0.01" value={v.amount} onChange={set('amount')} aria-invalid={!!over} />
        </Field>
        <Field label="Project / job reference"><Input value={v.project_reference} onChange={set('project_reference')} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={v.description} onChange={set('description')} /></Field>
        {over && <Field label="Justification for exceeding the limit" required className="sm:col-span-2"><Textarea value={v.justification} onChange={set('justification')} /></Field>}
      </div>
      <FileDrop files={files} onChange={setFiles} label={cat && Number(v.amount) > Number(cat.receipt_required_above) ? 'Attach receipt (required)' : 'Attach receipts'} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" loading={save.isPending && save.variables === false} disabled={!v.category_id || !v.title || !v.amount} onClick={() => save.mutate(false)}>Save draft</Button>
        <Button loading={save.isPending && save.variables === true} disabled={!v.category_id || !v.title || !v.amount || (over && !v.justification)} onClick={() => save.mutate(true)}><Send /> Submit</Button>
      </div>
    </div>
  )
}

export function SubmitClaimPage() {
  const nav = useNavigate()
  return <div><PageHeader title="Submit a claim" description="Receipts are checked against category rules and expense policies; identical receipts are detected." /><Card className="max-w-3xl p-5"><ClaimForm onDone={() => nav('/claims/mine')} /></Card></div>
}

export function ClaimDetail({ claim, onClose }: { claim: any; onClose: () => void }) {
  const att = useQuery({ queryKey: ['claims', 'att', claim.id], queryFn: () => unwrap<any[]>(db.from('claim_attachments').select('*').eq('claim_id', claim.id)) })
  const submit = useAction(() => rpc('submit_claim', { p_claim: claim.id }), { success: 'Claim submitted', invalidate: [['claims']], onSuccess: onClose })
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={claim.title} description={`${claim.claim_number} · ${claim.category_name}`}
      footer={['draft', 'rejected'].includes(claim.status) && claim.is_mine ? <Button onClick={() => submit.mutate()} loading={submit.isPending}><Send /> {claim.status === 'rejected' ? 'Resubmit' : 'Submit'}</Button> : undefined}>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-muted">Amount</dt><dd className="figure text-2xl">{money(claim.amount, true)}</dd></div>
        <div><dt className="text-muted">Status</dt><dd className="mt-1"><StatusBadge status={claim.status} /></dd></div>
        <div><dt className="text-muted">Expense date</dt><dd>{fmtDate(claim.expense_date)}</dd></div>
        <div><dt className="text-muted">Reference</dt><dd>{claim.project_reference ?? '—'}</dd></div>
        {claim.description && <div className="col-span-2"><dt className="text-muted">Description</dt><dd>{claim.description}</dd></div>}
        {claim.policy_violation && <div className="col-span-2 rounded-md bg-warning-soft p-3 text-warning"><b>Policy exception:</b> {claim.policy_violation}{claim.justification && <div className="mt-1 text-text">Justification: {claim.justification}</div>}</div>}
        {claim.is_possible_duplicate && <div className="col-span-2 rounded-md bg-danger-soft p-3 text-danger">Possible duplicate of another claim (same date, amount and category, or identical receipt).</div>}
        {claim.rejection_reason && <div className="col-span-2 rounded-md bg-danger-soft p-3 text-danger"><b>Rejected:</b> {claim.rejection_reason}</div>}
        {claim.batch_reference && <div className="col-span-2"><dt className="text-muted">Reimbursed</dt><dd>{claim.batch_reference} on {fmtDate(claim.paid_on)}</dd></div>}
      </dl>
      <h4 className="mb-2 mt-6 text-sm font-semibold">Receipts</h4>
      {(att.data ?? []).length === 0 ? <p className="text-sm text-muted">No receipts attached.</p> : (
        <ul className="space-y-1.5">{att.data!.map((a) => <li key={a.id}><button onClick={() => openFile('claim-receipts', a.storage_path).catch((e) => toast.error(errorMessage(e)))} className="flex items-center gap-2 text-sm text-primary hover:underline"><Paperclip className="h-4 w-4" />{a.file_name}<ExternalLink className="h-3 w-3" /></button></li>)}</ul>
      )}
      <h4 className="mb-1 mt-6 text-sm font-semibold">Approval</h4>
      <MyRequestStatus entityType="expense_claim" entityId={claim.id} />
    </Drawer>
  )
}

export function MyClaimsPage({ embedded }: { embedded?: boolean }) {
  const { employeeId } = useMe()
  const q = useClaims((x) => x.eq('employee_id', employeeId), `mine-${employeeId}`)
  const [open, setOpen] = useState<any | null>(null)
  const [creating, setCreating] = useState(false)
  const del = useAction((id: string) => unwrap(db.from('expense_claims').delete().eq('id', id).eq('status', 'draft').select('id')), { success: 'Draft deleted', invalidate: [['claims']] })
  return (
    <div className="space-y-4">
      {!embedded && <PageHeader title="My claims" actions={<Button onClick={() => setCreating(true)}><Plus /> New claim</Button>} />}
      {embedded && <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus /> New claim</Button></div>}
      <StatStrip items={[
        { label: 'Drafts', value: (q.data ?? []).filter((r) => r.status === 'draft').length },
        { label: 'Awaiting approval', value: money((q.data ?? []).filter((r) => r.status === 'submitted').reduce((a, r) => a + Number(r.amount), 0)), tone: 'warning' },
        { label: 'Approved, to be paid', value: money((q.data ?? []).filter((r) => r.status === 'approved').reduce((a, r) => a + Number(r.approved_amount ?? r.amount), 0)), tone: 'primary' },
        { label: 'Reimbursed (all time)', value: money((q.data ?? []).filter((r) => r.status === 'reimbursed').reduce((a, r) => a + Number(r.approved_amount ?? r.amount), 0)), tone: 'success' },
      ]} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={(r) => setOpen({ ...r, is_mine: true })} columns={[...claimCols(false),
        { key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => r.status === 'draft' && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); del.mutate(r.id) }}>Delete</Button> }]}
        emptyTitle="No claims yet" emptyDescription="Submit travel, food, fuel and other business expenses with receipts." />
      {open && <ClaimDetail claim={open} onClose={() => setOpen(null)} />}
      <Dialog open={creating} onOpenChange={setCreating} title="New claim" size="lg"><ClaimForm onDone={() => setCreating(false)} /></Dialog>
    </div>
  )
}

export function AllClaimsPage() {
  const [status, setStatus] = useState('')
  const q = useClaims(status ? (x) => x.eq('status', status) : undefined, `all-${status}`)
  const [open, setOpen] = useState<any | null>(null)
  return (
    <div>
      <PageHeader title="All claims" />
      <DataTable rows={q.data} columns={claimCols(true)} loading={q.isLoading} error={q.error} onRowClick={setOpen} exportName="All claims"
        toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status"><option value="">All statuses</option>{['draft', 'submitted', 'approved', 'rejected', 'reimbursed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>} />
      {open && <ClaimDetail claim={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

export const ClaimApprovalsPage = () => <ApprovalsInbox entityTypes={['expense_claim']} title="Claim approvals" description="Default flow: reporting manager, then finance verification. Change steps and amount thresholds in Administration › Approval Configuration." />

export function ReimbursementsPage() {
  const approved = useClaims((x) => x.eq('status', 'approved'), 'approved')
  const batches = useQuery({ queryKey: ['claims', 'batches'], queryFn: () => unwrap<any[]>(db.from('reimbursements').select('*').order('created_at', { ascending: false })) })
  const [sel, setSel] = useState<any[] | null>(null)
  const [ref, setRef] = useState(''); const [mode, setMode] = useState('bank_transfer'); const [paid, setPaid] = useState(isoDate())
  const pay = useAction(() => rpc('reimburse_claims', { p_claims: sel!.map((c) => c.id), p_reference: ref, p_mode: mode, p_paid_on: paid }), { success: 'Reimbursement recorded and employees notified', invalidate: [['claims']], onSuccess: () => { setSel(null); setRef('') } })
  return (
    <div className="space-y-6">
      <PageHeader title="Reimbursement processing" description="Select approved claims, record the payment batch, and employees are notified." />
      <DataTable rows={approved.data} columns={claimCols(true)} loading={approved.isLoading} selectable exportName="Approved claims"
        bulkActions={(rows, clear) => <Button size="sm" onClick={() => { setSel(rows); clear() }}><Banknote /> Reimburse {money(rows.reduce((a, r) => a + Number(r.approved_amount ?? r.amount), 0))}</Button>}
        emptyTitle="No approved claims waiting" />
      <Card><CardHeader title="Payment batches" /><div className="p-3"><DataTable rows={batches.data} loading={batches.isLoading} searchable={false} columns={[
        { key: 'batch_reference', header: 'Reference' }, { key: 'paid_on', header: 'Paid on', cell: (r) => fmtDate(r.paid_on) }, { key: 'payment_mode', header: 'Mode', value: (r) => titleCase(r.payment_mode) },
        { key: 'claim_count', header: 'Claims', className: 'tnum' }, { key: 'total_amount', header: 'Total', cell: (r) => money(r.total_amount, true) },
      ]} /></div></Card>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} title={`Reimburse ${sel?.length ?? 0} claims`} description={sel ? `Total ${money(sel.reduce((a, r) => a + Number(r.approved_amount ?? r.amount), 0), true)}` : ''}
        footer={<><Button variant="secondary" onClick={() => setSel(null)}>Cancel</Button><Button loading={pay.isPending} disabled={!ref.trim()} onClick={() => pay.mutate()}>Record payment</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment reference" required className="sm:col-span-2"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR / batch number" /></Field>
          <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)}>{['bank_transfer', 'cash', 'cheque', 'payroll'].map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}</Select></Field>
          <Field label="Paid on"><Input type="date" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function ReceiptsPage() {
  const q = useQuery({ queryKey: ['claims', 'receipts'], queryFn: () => unwrap<any[]>(db.from('claim_attachments').select('*, expense_claims(claim_number, title, amount, status, employee_id)').order('uploaded_at', { ascending: false }).limit(300)) })
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null)
  return (
    <div>
      <PageHeader title="Receipt attachments" description="All receipts you are allowed to see. Files are private; links expire after five minutes." />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} columns={[
        { key: 'file_name', header: 'File', cell: (r) => <button className="flex items-center gap-1.5 text-primary hover:underline" onClick={async () => { try { setPreview({ url: await signedUrl('claim-receipts', r.storage_path), name: r.file_name, mime: r.mime_type }) } catch (e) { toast.error(errorMessage(e)) } }}><Paperclip className="h-4 w-4" />{r.file_name}</button> },
        { key: 'claim', header: 'Claim', value: (r) => `${r.expense_claims?.claim_number} · ${r.expense_claims?.title}` }, { key: 'amount', header: 'Amount', cell: (r) => money(r.expense_claims?.amount) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.expense_claims?.status} /> }, { key: 'size_bytes', header: 'Size', value: (r) => `${Math.round((r.size_bytes ?? 0) / 1024)} KB`, hideOnMobile: true },
        { key: 'uploaded_at', header: 'Uploaded', cell: (r) => fmtDate(r.uploaded_at), hideOnMobile: true },
      ]} />
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)} title={preview?.name ?? ''} size="lg">
        {preview && (preview.mime?.startsWith('image/') ? <img src={preview.url} alt={preview.name} className="mx-auto max-h-[70vh] rounded-md" /> : <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full rounded-md border border-line" />)}
      </Dialog>
    </div>
  )
}

export const ClaimCategoriesPage = () => <CrudPage cfg={{
  title: 'Claim categories', table: 'claim_categories', permission: 'claims.manage', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
  columns: [{ key: 'name', header: 'Category' }, { key: 'code', header: 'Code' }, { key: 'receipt_required_above', header: 'Receipt required above', cell: (r) => money(r.receipt_required_above) }, { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') }],
  fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'code', label: 'Code', type: 'text' }, { name: 'receipt_required_above', label: 'Receipt required above (₹)', type: 'number', min: 0, default: 0, required: true },
    { name: 'description', label: 'Description', type: 'textarea' }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
}} />

export const ExpensePoliciesPage = () => <CrudPage cfg={{
  title: 'Expense policies', description: 'Limits per claim and per month, optionally by designation. Exceeding a limit requires justification (or is blocked, if configured).',
  table: 'expense_policies', select: '*, claim_categories(name), designations(name)', permission: 'claims.manage', remove: { column: 'is_active', value: false },
  columns: [{ key: 'cat', header: 'Category', value: (r) => r.claim_categories?.name }, { key: 'des', header: 'Designation', value: (r) => r.designations?.name ?? 'Everyone' },
    { key: 'per_claim_limit', header: 'Per claim', cell: (r) => money(r.per_claim_limit) }, { key: 'monthly_limit', header: 'Per month', cell: (r) => money(r.monthly_limit) },
    { key: 'max_days_after_expense', header: 'Submit within', value: (r) => `${r.max_days_after_expense} days` }, { key: 'allow', header: 'Over limit', value: (r) => (r.allow_exceed_with_justification ? 'With justification' : 'Blocked') }],
  fields: [{ name: 'category_id', label: 'Category', type: 'lookup', lookup: { table: 'claim_categories' }, required: true }, { name: 'designation_id', label: 'Designation (empty = everyone)', type: 'lookup', lookup: { table: 'designations' } },
    { name: 'per_claim_limit', label: 'Per-claim limit (₹)', type: 'number', min: 0 }, { name: 'monthly_limit', label: 'Monthly limit (₹)', type: 'number', min: 0 },
    { name: 'max_days_after_expense', label: 'Submit within (days)', type: 'number', min: 1, default: 60, required: true }, { name: 'allow_exceed_with_justification', label: 'Allow exceeding with justification', type: 'switch', default: true },
    { name: 'is_active', label: 'Active', type: 'switch', default: true }],
}} />
