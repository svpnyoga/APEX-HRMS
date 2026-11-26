import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScanFace, Send, X } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAction, useRpc } from '@/hooks/data'
import { FaceScanner, type EnrolCapture } from '@/face/FaceScanner'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader } from '@/components/ui/misc'
import { fmtDate, fmtDateTime } from '@/lib/utils'

/** Employee's own face enrolment: first time freely (HR present); afterwards only with an HR-approved request. */
export function FaceSelfCard({ consent, onNeedConsent }: { consent: boolean; onNeedConsent: () => void }) {
  const st = useRpc<any>(['face-self'], 'face_self_status')
  const settings = useQuery({ queryKey: ['company-settings', 'face'], queryFn: () => unwrap<any>(db.from('company_settings').select('face_min_samples, face_provider, face_antispoof_threshold, face_liveness_threshold').single()) })
  const [enrolOpen, setEnrolOpen] = useState(false)
  const [reqOpen, setReqOpen] = useState(false)
  const [reason, setReason] = useState('')
  const s = st.data
  const inv = [['face-self'], ['my-home']]
  const enrol = useAction((c: EnrolCapture) => rpc('face_self_enrol', { p_model: c.modelId, p_embeddings: c.embeddings, p_qualities: c.qualities }),
    { success: 'Face enrolled. You can now clock in with your face.', invalidate: inv, onSuccess: () => setEnrolOpen(false) })
  const request = useAction(() => rpc('request_face_reenrol', { p_reason: reason }), { success: 'Request sent to HR', invalidate: inv, onSuccess: () => { setReqOpen(false); setReason('') } })
  const cancel = useAction(() => rpc('cancel_face_reenrol'), { success: 'Request withdrawn', invalidate: inv })
  const onEnrol = useCallback((c: EnrolCapture) => enrol.mutate(c), []) // eslint-disable-line
  if (!s || s.state === 'disabled' || s.state === 'no_employee') return null
  const cfg = settings.data
  const startEnrol = () => (consent ? setEnrolOpen(true) : onNeedConsent())
  const last = s.last_request

  const body = (() => {
    switch (s.state) {
      case 'first_enrolment': return { tone: 'warning', badge: 'Not enrolled', text: 'Enrol your face once, with HR present. Use this phone — it is the one you will clock in with.',
        action: <Button onClick={startEnrol}><ScanFace /> Enrol my face</Button> }
      case 'reenrol_approved': return { tone: 'success', badge: 'Re-enrolment approved', text: `HR approved your request${last?.decided_at ? ` on ${fmtDate(last.decided_at)}` : ''}. Enrol again on the phone you clock in with. This approval works once.`,
        action: <Button onClick={startEnrol}><ScanFace /> Enrol again</Button> }
      case 'reenrol_pending': return { tone: 'info', badge: 'Request pending', text: `Waiting for HR to approve your re-enrolment request (sent ${fmtDateTime(last?.requested_at)}). Reason: ${last?.reason}`,
        action: <Button variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate()}><X /> Withdraw request</Button> }
      case 'revoked': return { tone: 'danger', badge: 'Removed by HR', text: 'Your face enrolment was removed. Ask HR to re-enrol you, or send a request.',
        action: <Button variant="secondary" onClick={() => setReqOpen(true)}><Send /> Request re-enrolment</Button> }
      default: return { tone: 'success', badge: 'Enrolled', text: `Enrolled on ${fmtDate(s.enrolled_at)} with ${s.samples} samples. To enrol again (new phone, big change in appearance, face not matching), send a request to HR.`,
        action: <Button variant="secondary" onClick={() => setReqOpen(true)}><Send /> Request re-enrolment</Button> }
    }
  })()

  return (
    <Card>
      <CardHeader title="Face attendance" description="Your face is checked when you clock in. Only a numeric face descriptor is stored — never a photo." />
      <div className="space-y-3 p-5">
        <div className="flex items-center gap-2"><Badge tone={body.tone as any}>{body.badge}</Badge></div>
        <p className="text-sm text-muted">{body.text}</p>
        {last?.status === 'rejected' && s.state === 'enrolled' && <p className="text-sm text-danger">Your last request was not approved: {last.comment}</p>}
        {body.action}
      </div>
      <Dialog open={enrolOpen} onOpenChange={setEnrolOpen} title="Enrol my face" description={`Hold the phone at eye level in good light. ${cfg?.face_min_samples ?? 5} samples are taken — turn your head slightly between them.`}>
        {enrolOpen && <FaceScanner mode="enrol" samples={cfg?.face_min_samples ?? 5} providerId={cfg?.face_provider}
          thresholds={{ antispoof: Number(cfg?.face_antispoof_threshold ?? 0.5), liveness: Number(cfg?.face_liveness_threshold ?? 0.5) }} onEnrol={onEnrol}
          resultLabel={enrol.isPending ? { tone: 'success', text: 'Saving…' } : enrol.isError ? { tone: 'danger', text: 'Could not save — see the message and try again' } : null} />}
      </Dialog>
      <Dialog open={reqOpen} onOpenChange={setReqOpen} title="Request re-enrolment" description="HR will review your request. Once approved, you can enrol again once."
        footer={<Button disabled={!reason.trim()} loading={request.isPending} onClick={() => request.mutate()}><Send /> Send request</Button>}>
        <Field label="Reason" required hint="e.g. New phone, face often not matching, grew a beard"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
      </Dialog>
    </Card>
  )
}
