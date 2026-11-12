import { Badge, type Tone } from '@/components/ui/misc'
import { titleCase } from '@/lib/utils'

const MAP: Record<string, Tone> = {
  active: 'success', approved: 'success', present: 'success', completed: 'success', verified: 'success', matched: 'success', published: 'success',
  reimbursed: 'success', locked: 'success', cleared: 'success', done: 'success', enrolled: 'primary', paid: 'success', resolved: 'success', going: 'success',
  pending: 'warning', submitted: 'warning', in_progress: 'primary', calculated: 'info', draft: 'neutral', probation: 'info', notice: 'warning',
  onboarding: 'info', half_day: 'warning', incomplete: 'warning', late: 'warning', in_review: 'info', pending_approval: 'warning', in_clearance: 'warning',
  open: 'info', scheduled: 'info', goal_setting: 'info', dues_pending: 'warning', maybe: 'warning',
  rejected: 'danger', absent: 'danger', failed: 'danger', cancelled: 'neutral', withdrawn: 'neutral', exited: 'neutral', inactive: 'neutral', archived: 'neutral',
  no_match: 'danger', spoof_suspected: 'danger', liveness_failed: 'danger', rate_limited: 'danger', not_enrolled: 'neutral', no_consent: 'warning', error: 'danger',
  on_leave: 'primary', holiday: 'info', weekly_off: 'neutral', closed: 'neutral', revoked: 'neutral', not_going: 'neutral',
}

export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return <Badge>—</Badge>
  return <Badge tone={MAP[status] ?? 'neutral'} dot>{label ?? titleCase(status)}</Badge>
}
