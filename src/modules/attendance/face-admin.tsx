import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ScanFace, ShieldCheck, Gauge, Trash2, Settings2 } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAction, useDirectory, useRpc } from '@/hooks/data'
import { FaceScanner, type EnrolCapture, type VerifyCapture } from '@/face/FaceScanner'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, StatStrip } from '@/components/common/page'
import { EmployeeCell } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { ConsentDialog } from '@/modules/self/consent'
import { fmtDateTime, titleCase } from '@/lib/utils'

export function FaceAdmin() {
  const dir = useDirectory()
  const confirm = useConfirm()
  const settings = useQuery({ queryKey: ['company-settings'], queryFn: () => unwrap<any>(db.from('company_settings').select('*').single()) })
  const enrol = useQuery({ queryKey: ['face-admin', 'enrolments'], queryFn: () => unwrap<any[]>(db.from('face_enrolments').select('*')) })
  const consents = useQuery({ queryKey: ['face-admin', 'consents'], queryFn: () => unwrap<any[]>(db.from('data_consents').select('employee_id, consent_type, granted, granted_at, revoked_at').eq('consent_type', 'biometric').order('granted_at', { ascending: false })) })
  const attempts = useQuery({ queryKey: ['face-admin', 'attempts'], queryFn: () => unwrap<any[]>(db.from('face_recognition_attempts').select('*').order('created_at', { ascending: false }).limit(500)) })
  const [enrolFor, setEnrolFor] = useState<any | null>(null)
  const [testFor, setTestFor] = useState<any | null>(null)
  const [consentFor, setConsentFor] = useState<any | null>(null)
  const [testResult, setTestResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  const s = settings.data
  const byEmp = new Map((enrol.data ?? []).map((e) => [e.employee_id, e]))
  const consentBy = new Map<string, boolean>()
  for (const c of consents.data ?? []) if (!consentBy.has(c.employee_id)) consentBy.set(c.employee_id, c.granted && !c.revoked_at)
  const names = new Map((dir.data ?? []).map((d) => [d.id, d]))
  const rows = (dir.data ?? []).map((d) => ({ ...d, enrolment: byEmp.get(d.id), consent: consentBy.get(d.id) ?? false }))

  const doEnrol = useAction((c: EnrolCapture & { employee: string }) => rpc('face_enrol', { p_employee: c.employee, p_model: c.modelId, p_embeddings: c.embeddings, p_qualities: c.qualities }), {
    success: (r: any) => `Enrolled with ${r.samples} samples`, invalidate: [['face-admin']], onSuccess: () => setEnrolFor(null),
  })
  const revoke = useAction((id: string) => rpc('face_revoke_enrolment', { p_employee: id, p_reason: 'Revoked by HR' }), { success: 'Face templates deleted', invalidate: [['face-admin']] })

  const onEnrol = useCallback((c: EnrolCapture) => { if (enrolFor) doEnrol.mutate({ ...c, employee: enrolFor.id }) }, [enrolFor]) // eslint-disable-line
  const onTest = useCallback(async (c: VerifyCapture) => {
    if (!testFor) return
    const r: any = await rpc('face_test_match', { p_employee: testFor.id, p_embedding: JSON.stringify(c.embedding), p_model: c.modelId })
    const th = Number(s?.face_match_threshold ?? 0.6)
    setTestResult({ tone: r.similarity >= th ? 'success' : 'danger', text: `Similarity ${r.similarity} (threshold ${th}) · anti-spoof ${c.antispoof.toFixed(2)} · liveness ${c.liveness.toFixed(2)}` })
  }, [testFor, s])

  const enrolled = rows.filter((r) => r.enrolment?.status === 'enrolled').length
  const today = (attempts.data ?? []).filter((a) => new Date(a.created_at).toDateString() === new Date().toDateString())

  const cols: Column<any>[] = [
    { key: 'full_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.full_name} photo={r.photo_url} sub={`${r.employee_code} · ${r.department_name ?? '—'}`} /> },
    { key: 'consent', header: 'Consent', value: (r) => (r.consent ? 'Given' : 'Not given'), cell: (r) => <Badge tone={r.consent ? 'success' : 'warning'}>{r.consent ? 'Given' : 'Not given'}</Badge> },
    { key: 'status', header: 'Enrolment', value: (r) => r.enrolment?.status ?? 'not_enrolled', cell: (r) => <StatusBadge status={r.enrolment?.status ?? 'not_enrolled'} /> },
    { key: 'samples', header: 'Samples', value: (r) => r.enrolment?.samples_count ?? 0, hideOnMobile: true },
    { key: 'quality', header: 'Avg quality', value: (r) => r.enrolment?.avg_quality ?? null, hideOnMobile: true },
    { key: 'enrolled_at', header: 'Enrolled', value: (r) => r.enrolment?.enrolled_at, cell: (r) => fmtDateTime(r.enrolment?.enrolled_at), hideOnMobile: true },
    { key: '_actions', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => (
      <div className="flex justify-end gap-1.5">
        {!r.consent && <Button size="sm" variant="secondary" onClick={() => setConsentFor(r)}><ShieldCheck /> Record consent</Button>}
        {r.consent && <Button size="sm" onClick={() => setEnrolFor(r)}><ScanFace /> {r.enrolment?.status === 'enrolled' ? 'Re-enrol' : 'Enrol'}</Button>}
        {r.enrolment?.status === 'enrolled' && <Button size="sm" variant="secondary" onClick={() => { setTestResult(null); setTestFor(r) }}><Gauge /> Test</Button>}
        {r.enrolment?.status === 'enrolled' && (
          <Button size="icon-sm" variant="ghost" aria-label="Delete templates" onClick={async () => {
            if ((await confirm({ title: `Delete ${r.full_name}'s face templates?`, description: 'They will need to be enrolled again to use face attendance.', danger: true, confirmLabel: 'Delete' })).ok) revoke.mutate(r.id)
          }}><Trash2 /></Button>
        )}
      </div>
    ) },
  ]
  const attemptCols: Column<any>[] = [
    { key: 'created_at', header: 'Time', cell: (r) => fmtDateTime(r.created_at) },
    { key: 'employee', header: 'Employee', value: (r) => names.get(r.employee_id)?.full_name ?? '—' },
    { key: 'mode', header: 'Mode', value: (r) => titleCase(r.mode) },
    { key: 'outcome', header: 'Outcome', cell: (r) => <StatusBadge status={r.outcome} /> },
    { key: 'similarity', header: 'Similarity', className: 'tnum' },
    { key: 'antispoof_score', header: 'Anti-spoof', className: 'tnum', hideOnMobile: true },
    { key: 'liveness_score', header: 'Liveness', className: 'tnum', hideOnMobile: true },
    { key: 'challenge_passed', header: 'Challenge', value: (r) => (r.challenge_passed == null ? '—' : r.challenge_passed ? 'Passed' : 'Failed'), hideOnMobile: true },
    { key: 'reason', header: 'Reason', hideOnMobile: true },
  ]

  return (
    <div className="space-y-5">
      <PageHeader title="Face recognition" description="Enrol employees in person with several samples, test matching, and review every recognition attempt. Templates are stored server-side and are never downloadable."
        actions={<Link to="/admin/integrations"><Button variant="secondary"><Settings2 /> Thresholds & provider</Button></Link>} />
      <StatStrip items={[
        { label: 'Enrolled', value: `${enrolled}/${rows.length}`, tone: 'primary' },
        { label: 'Match threshold', value: s?.face_match_threshold ?? '—', hint: 'Mean of top-3 template similarities' },
        { label: 'Anti-spoof / liveness', value: s ? `${s.face_antispoof_threshold} / ${s.face_liveness_threshold}` : '—' },
        { label: 'Attempts today', value: today.length },
        { label: 'Failed today', value: today.filter((a) => a.outcome !== 'matched').length, tone: 'danger' },
      ]} />
      <Tabs defaultValue="people">
        <TabsList><TabsTrigger value="people">Enrolment</TabsTrigger><TabsTrigger value="log">Recognition log</TabsTrigger></TabsList>
        <TabsContent value="people"><DataTable rows={rows} columns={cols} loading={dir.isLoading || enrol.isLoading} exportName="Face enrolment status" /></TabsContent>
        <TabsContent value="log"><DataTable rows={attempts.data} columns={attemptCols} loading={attempts.isLoading} error={attempts.error} exportName="Face recognition attempts" /></TabsContent>
      </Tabs>

      <Dialog open={!!enrolFor} onOpenChange={(o) => !o && setEnrolFor(null)} title={`Enrol ${enrolFor?.full_name ?? ''}`} description={`Capture at least ${s?.face_min_samples ?? 5} consistent samples with slight pose changes. The employee must be physically present.`}>
        {enrolFor && <FaceScanner mode="enrol" samples={s?.face_min_samples ?? 5} providerId={s?.face_provider} thresholds={{ antispoof: Number(s?.face_antispoof_threshold ?? 0.5), liveness: Number(s?.face_liveness_threshold ?? 0.5) }} onEnrol={onEnrol}
          resultLabel={doEnrol.isPending ? { tone: 'success', text: 'Saving templates…' } : doEnrol.isError ? { tone: 'danger', text: 'Could not save — try again' } : null} />}
      </Dialog>
      <Dialog open={!!testFor} onOpenChange={(o) => !o && setTestFor(null)} title={`Test match · ${testFor?.full_name ?? ''}`} description="Runs the full liveness check and reports the similarity score without recording attendance. Use this to calibrate the threshold.">
        {testFor && <FaceScanner mode="verify" onVerify={onTest} resultLabel={testResult} />}
      </Dialog>
      {consentFor && <ConsentDialog open={!!consentFor} onOpenChange={(o) => !o && setConsentFor(null)} type="biometric" employeeId={consentFor.id} onDone={() => consents.refetch()} />}
    </div>
  )
}
