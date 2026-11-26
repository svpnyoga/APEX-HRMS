import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { db, unwrap } from '@/lib/api'
import { useAuth } from '@/app/auth'
import { useAction } from '@/hooks/data'
import { availableProviders } from '@/face'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Card, CardHeader, Switch } from '@/components/ui/misc'
import { LoadingRows } from '@/components/common/page'
import { cn } from '@/lib/utils'

type F = { key: string; label: string; type: 'time' | 'number' | 'switch' | 'select' | 'weekdays' | 'text' | 'email'; hint?: string; options?: { value: string; label: string }[]; step?: string; min?: number; max?: number }
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const SECTIONS: Record<string, { title: string; description: string; fields: F[] }> = {
  attendance: { title: 'Attendance rules', description: 'Company reporting time applies unless an employee has a shift or schedule.', fields: [
    { key: 'reporting_time', label: 'Reporting time', type: 'time' }, { key: 'end_time', label: 'End time', type: 'time' },
    { key: 'grace_minutes', label: 'Grace period (minutes)', type: 'number', min: 0, max: 120, hint: 'Check-ins after reporting time + grace are marked Late' },
    { key: 'early_departure_minutes', label: 'Early departure allowance (minutes)', type: 'number', min: 0 },
    { key: 'full_day_min_minutes', label: 'Minimum minutes for a full day', type: 'number' }, { key: 'half_day_min_minutes', label: 'Minimum minutes for a half day', type: 'number' },
    { key: 'weekly_off_days', label: 'Weekly off days', type: 'weekdays' },
    { key: 'missing_checkout_policy', label: 'Missing check-out treatment', type: 'select', options: [{ value: 'flag', label: 'Flag for review (incomplete)' }, { value: 'half_day', label: 'Treat as half day' }, { value: 'absent', label: 'Treat as absent' }] },
    { key: 'overtime_enabled', label: 'Calculate overtime', type: 'switch' }, { key: 'overtime_min_minutes', label: 'Minimum overtime (minutes)', type: 'number' },
    { key: 'overtime_rate_multiplier', label: 'Overtime pay multiplier', type: 'number', step: '0.05' },
    { key: 'offline_max_age_hours', label: 'Accept offline punches up to (hours old)', type: 'number', min: 1, max: 336 },
  ] },
  leave: { title: 'Leave configuration', description: 'How leave days are counted and when the leave year starts.', fields: [
    { key: 'leave_year_start_month', label: 'Leave year starts in month (1–12)', type: 'number', min: 1, max: 12 },
    { key: 'leave_count_weekly_offs', label: 'Count weekly offs inside a leave range', type: 'switch' }, { key: 'leave_count_holidays', label: 'Count holidays inside a leave range', type: 'switch' },
  ] },
  payroll: { title: 'Payroll configuration', description: 'Loss-of-pay basis and statutory state.', fields: [
    { key: 'payroll_day', label: 'Pay day of month', type: 'number', min: 1, max: 28 },
    { key: 'lop_basis', label: 'Days in period for proration', type: 'select', options: [{ value: 'calendar_days', label: 'Calendar days' }, { value: 'working_days', label: 'Working days' }, { value: 'fixed_30', label: 'Fixed 30 days' }] },
    { key: 'absent_counts_as_lop', label: 'Unapproved absence counts as loss of pay', type: 'switch' }, { key: 'payroll_state', label: 'Default state for professional tax', type: 'text' },
  ] },
  face: { title: 'Face recognition', description: 'Thresholds apply on the server. Use “Test match” on the Face Recognition page to calibrate with real employees before tightening or loosening.', fields: [
    { key: 'face_recognition_enabled', label: 'Face recognition enabled', type: 'switch' }, { key: 'face_required_for_clock', label: 'Require face for web/mobile clock-in', type: 'switch' },
    { key: 'face_provider', label: 'Recognition provider', type: 'select', options: availableProviders.map((p) => ({ value: p, label: p })) },
    { key: 'face_match_threshold', label: 'Match threshold (0–1)', type: 'number', step: '0.01', hint: 'Mean of top-3 template similarities must reach this. Default 0.60' },
    { key: 'face_antispoof_threshold', label: 'Anti-spoofing threshold', type: 'number', step: '0.01' }, { key: 'face_liveness_threshold', label: 'Liveness threshold', type: 'number', step: '0.01' },
    { key: 'face_min_samples', label: 'Samples required at enrolment', type: 'number', min: 3, max: 10 }, { key: 'face_max_attempts_per_hour', label: 'Failed attempts allowed per hour', type: 'number', min: 3 },
    { key: 'face_preload_models', label: 'Faster: load face models when the app opens', type: 'switch', hint: 'The first clock-in of the day starts without waiting for models to download' },
    { key: 'face_single_challenge', label: 'Faster: one random check (blink OR head turn) instead of both', type: 'switch', hint: 'Off = blink AND head turn on every punch' },
    { key: 'face_easy_turn', label: 'Faster: smaller head turn, one side only', type: 'switch' },
    { key: 'face_skip_challenge_in_office', label: 'Skip blink/turn when clocking in inside the office radius', type: 'switch', hint: 'Only for live punches with good GPS at an office site — checked by the server. Outside the office the check is always done.' },
    { key: 'biometric_retention_days', label: 'Delete templates this many days after exit', type: 'number' }, { key: 'recognition_log_retention_days', label: 'Keep recognition logs (days)', type: 'number' },
  ] },
  gps: { title: 'GPS & tracking', description: 'Location never blocks attendance. Tracking pings are accepted only between the start and end times.', fields: [
    { key: 'gps_mode', label: 'GPS on punches', type: 'select', options: [{ value: 'flag', label: 'Record and flag outside geofence' }, { value: 'record', label: 'Record only' }, { value: 'off', label: 'Off' }] },
    { key: 'tracking_start', label: 'Tracking window starts', type: 'time' }, { key: 'tracking_end', label: 'Tracking window ends', type: 'time' },
    { key: 'allow_new_site_entry', label: 'Employees can enter a new site (needs approval)', type: 'switch' }, { key: 'location_retention_days', label: 'Keep location history (days)', type: 'number' },
  ] },
  security: { title: 'Security', description: 'Session and access policies.', fields: [
    { key: 'session_timeout_minutes', label: 'Sign out after inactivity (minutes)', type: 'number', min: 15 },
    { key: 'enforce_mfa_for_admins', label: 'Require two-factor sign-in for administrators', type: 'switch', hint: 'Enable TOTP MFA in Supabase Auth settings for this to take effect' },
  ] },
  email: { title: 'Email', description: 'Sender identity for notification emails. The provider API key is stored as an edge-function secret, never in the database.', fields: [
    { key: 'email_from_name', label: 'From name', type: 'text' }, { key: 'email_from_address', label: 'From address', type: 'email' },
  ] },
}

export function SettingsForm({ section }: { section: keyof typeof SECTIONS }) {
  const { can } = useAuth()
  const meta = SECTIONS[section]
  const q = useQuery({ queryKey: ['company-settings'], queryFn: () => unwrap<any>(db.from('company_settings').select('*').single()) })
  const [v, setV] = useState<any>(null)
  useEffect(() => { if (q.data) setV(q.data) }, [q.data])
  const save = useAction(() => {
    const payload = Object.fromEntries(meta.fields.map((f) => [f.key, f.type === 'number' ? Number(v[f.key]) : f.type === 'time' ? String(v[f.key]).slice(0, 5) : v[f.key]]))
    return unwrap(db.from('company_settings').update(payload).eq('organisation_id', v.organisation_id).select('organisation_id'))
  }, { success: 'Settings saved', invalidate: [['company-settings'], ['my-home']] })
  const editable = can('admin.manage')
  return (
    <Card>
      <CardHeader title={meta.title} description={meta.description} actions={editable && <Button loading={save.isPending} onClick={() => save.mutate()} disabled={!v}><Save /> Save</Button>} />
      {!v ? <LoadingRows /> : (
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {meta.fields.map((f) => (
            <Field key={f.key} label={f.type === 'switch' ? undefined : f.label} hint={f.hint} className={cn(f.type === 'weekdays' && 'sm:col-span-2')}>
              {f.type === 'switch' ? (
                <label className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">{f.label}<Switch disabled={!editable} checked={!!v[f.key]} onCheckedChange={(x) => setV({ ...v, [f.key]: x })} /></label>
              ) : f.type === 'select' ? (
                <Select disabled={!editable} value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
              ) : f.type === 'weekdays' ? (
                <div className="flex flex-wrap gap-1.5">{WD.map((d, i) => { const on = (v[f.key] ?? []).includes(i); return (
                  <button key={d} type="button" disabled={!editable} onClick={() => setV({ ...v, [f.key]: on ? v[f.key].filter((x: number) => x !== i) : [...(v[f.key] ?? []), i].sort() })}
                    className={cn('h-8 w-12 rounded-md border text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>{d}</button>) })}</div>
              ) : (
                <Input disabled={!editable} type={f.type} step={f.step} min={f.min} max={f.max} value={f.type === 'time' ? String(v[f.key] ?? '').slice(0, 5) : v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
      )}
    </Card>
  )
}
