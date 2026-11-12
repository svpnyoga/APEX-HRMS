import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { rpc } from '@/lib/api'
import { useAction } from '@/hooks/data'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export const POLICY_VERSION = 'v1'

const TEXT = {
  biometric: {
    title: 'Consent for face recognition attendance',
    points: [
      'What is collected: a numeric face descriptor (not a photo) derived from several images captured by HR at enrolment, and at each check-in.',
      'Why: to confirm it is you when you record attendance. It is not used for anything else.',
      'Where it is stored: on the company server with access restricted to the matching function. No one, including HR, can download your face templates.',
      'Logs: each recognition attempt is logged (result and scores, no image) for security review.',
      'Retention: templates are deleted if you withdraw consent, and automatically after you leave the company per the retention period set by HR.',
      'Your choice: you can withdraw consent at any time from your profile. HR will then record your attendance another way.',
    ],
  },
  location: {
    title: 'Consent for location during work',
    points: [
      'What is collected: GPS position when you clock in/out, and during field visits within the configured working window.',
      'Why: to record site attendance and field activity. Location outside working hours is not accepted by the server.',
      'Who can see it: you, your reporting line and authorised HR/field managers.',
      'Retention: location records are deleted after the retention period set by HR.',
      'Your choice: you can withdraw consent at any time. Attendance never fails because location is missing.',
    ],
  },
} as const

export function ConsentDialog({ open, onOpenChange, type, onDone, employeeId }: { open: boolean; onOpenChange: (o: boolean) => void; type: 'biometric' | 'location'; onDone?: () => void; employeeId?: string }) {
  const [agree, setAgree] = useState(false)
  const t = TEXT[type]
  const save = useAction((granted: boolean) => rpc('record_consent', { p_type: type, p_granted: granted, p_policy_version: POLICY_VERSION, p_user_agent: navigator.userAgent, p_employee: employeeId ?? null }), {
    success: 'Your choice has been recorded', invalidate: [['my-home'], ['face-admin']], onSuccess: () => { onOpenChange(false); onDone?.() },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t.title} description={`Policy ${POLICY_VERSION}`}
      footer={<>
        <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>I do not consent</Button>
        <Button disabled={!agree} onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true}><ShieldCheck /> I consent</Button>
      </>}>
      <ul className="space-y-2.5 text-sm">
        {t.points.map((p) => <li key={p} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{p}</span></li>)}
      </ul>
      <label className="mt-5 flex items-start gap-2 rounded-md bg-raised p-3 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        <span>I have read this notice and agree to the processing described{employeeId ? ' (recorded by HR on the employee’s written consent)' : ''}.</span>
      </label>
    </Dialog>
  )
}
