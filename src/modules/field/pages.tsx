import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Play, Square, Navigation, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useRpc } from '@/hooks/data'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader, StatStrip, EmptyState } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { CrudPage } from '@/components/crud/CrudPage'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader } from '@/components/ui/misc'
import { ago, errorMessage, fmtDate, fmtDateTime, fmtTime, isoDate, minutes, titleCase } from '@/lib/utils'
import { SettingsForm } from '@/modules/admin/settings'
import { ConsentDialog } from '@/modules/self/consent'
import { FieldMap, type MapPoint } from './map'

/** Start of a calendar day in the user's own time zone, as an ISO timestamp (not UTC midnight). */
const dayStart = (d: string, plusDays = 0) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + plusDays); return x.toISOString() }
const distanceM = (a: number, b: number, c: number, d: number) => { const R = 6371000, r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)) }
const useSites = () => useQuery({ queryKey: ['field', 'sites'], queryFn: () => unwrap<any[]>(db.from('work_sites').select('*').eq('is_active', true)) })
function useLatest() {
  return useQuery({
    queryKey: ['field', 'latest'], refetchInterval: 30_000,
    queryFn: async () => {
      const rows = await unwrap<any[]>(db.from('field_location_records').select('employee_id, latitude, longitude, accuracy_m, recorded_at, employees(first_name, last_name, employee_code)').gte('recorded_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('recorded_at', { ascending: false }).limit(2000))
      const m = new Map<string, any>()
      for (const r of rows) if (!m.has(r.employee_id)) m.set(r.employee_id, r)
      return [...m.values()]
    },
  })
}
const toPoints = (rows: any[]): MapPoint[] => rows.map((r) => {
  const age = (Date.now() - new Date(r.recorded_at).getTime()) / 60000
  return { id: r.employee_id, lat: r.latitude, lng: r.longitude, label: `${r.employees?.first_name} ${r.employees?.last_name}`, sub: `${ago(r.recorded_at)} · ±${Math.round(r.accuracy_m ?? 0)} m`, tone: age < 15 ? 'success' : age < 60 ? 'warning' : 'danger' }
})

export function FieldDashboard() {
  const latest = useLatest(); const sites = useSites()
  const today = isoDate()
  const events = useQuery({ queryKey: ['field', 'events', today], queryFn: () => unwrap<any[]>(db.from('attendance_events').select('employee_id, site_id, within_geofence, is_flagged, method').eq('work_date', today)) })
  const visits = useQuery({ queryKey: ['field', 'visits-today'], queryFn: () => unwrap<any[]>(db.from('field_visits').select('id, check_out_at').gte('check_in_at', dayStart(today))) })
  const ev = events.data ?? []
  return (
    <div className="space-y-5">
      <PageHeader title="Field workforce" description="Site attendance, live positions (with consent, within working hours) and visits." />
      <StatStrip items={[
        { label: 'Active in last 15 min', value: (latest.data ?? []).filter((r) => Date.now() - new Date(r.recorded_at).getTime() < 15 * 60e3).length, tone: 'success' },
        { label: 'Site punches today', value: ev.filter((e) => e.site_id).length }, { label: 'Outside geofence', value: ev.filter((e) => e.within_geofence === false).length, tone: 'warning', to: '/field/geofencing' },
        { label: 'Visits today', value: visits.data?.length ?? '—', hint: `${(visits.data ?? []).filter((v) => !v.check_out_at).length} in progress`, to: '/field/visits' },
        { label: 'Active sites', value: sites.data?.length ?? '—', to: '/field/sites' },
      ]} />
      <FieldMap points={toPoints(latest.data ?? [])} sites={(sites.data ?? []).filter((s) => s.latitude).map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude, radius: s.radius_m, name: s.name }))} />
    </div>
  )
}

export function LiveLocationPage() {
  const latest = useLatest(); const sites = useSites()
  return (
    <div className="space-y-5">
      <PageHeader title="Employee live location" description="Last known position in the past 12 hours. Green: under 15 minutes old; amber: under an hour; red: older. Positions are only accepted inside the configured working window." />
      <FieldMap points={toPoints(latest.data ?? [])} sites={(sites.data ?? []).filter((s) => s.latitude).map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude, radius: s.radius_m, name: s.name }))} height={460} />
      <DataTable rows={latest.data} loading={latest.isLoading} rowKey="employee_id" columns={[
        { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}`, cell: (r) => <EmployeeCell name={`${r.employees?.first_name} ${r.employees?.last_name}`} code={r.employees?.employee_code} /> },
        { key: 'recorded_at', header: 'Last seen', cell: (r) => <span title={fmtDateTime(r.recorded_at)}>{ago(r.recorded_at)}</span> }, { key: 'accuracy_m', header: 'Accuracy', value: (r) => `±${Math.round(r.accuracy_m ?? 0)} m` },
        { key: 'coords', header: 'Coordinates', value: (r) => `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` },
      ]} emptyTitle="No live positions" emptyDescription="Field employees share location while a visit is active in self-service." />
    </div>
  )
}

export function SiteAttendancePage() {
  const [date, setDate] = useState(isoDate())
  const q = useQuery({ queryKey: ['field', 'site-att', date], queryFn: () => unwrap<any[]>(db.from('attendance_events').select('*, employees(first_name, last_name, employee_code), work_sites(name, is_approved)').eq('work_date', date).order('occurred_at', { ascending: false })) })
  return (
    <div>
      <PageHeader title="Site attendance" description="Every punch with its site, GPS status and geofence result. GPS problems are flagged, never blocking." />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName={`Site attendance ${date}`} columns={[
        { key: 'occurred_at', header: 'Time', cell: (r) => fmtTime(r.occurred_at) }, { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` },
        { key: 'event_type', header: 'Punch', cell: (r) => <Badge tone={r.event_type === 'in' ? 'success' : 'neutral'}>{r.event_type === 'in' ? 'In' : 'Out'}</Badge> },
        { key: 'method', header: 'Method', value: (r) => titleCase(r.method) }, { key: 'site', header: 'Site', value: (r) => r.work_sites?.name, cell: (r) => r.work_sites ? <span>{r.work_sites.name}{!r.work_sites.is_approved && <Badge tone="warning" className="ml-1">New site</Badge>}</span> : '—' },
        { key: 'gps_status', header: 'GPS', value: (r) => titleCase(r.gps_status) }, { key: 'geo', header: 'Geofence', value: (r) => (r.within_geofence == null ? '—' : r.within_geofence ? 'Inside' : `Outside (${Math.round(r.distance_from_site_m)} m)`), cell: (r) => r.within_geofence == null ? '—' : <Badge tone={r.within_geofence ? 'success' : 'warning'}>{r.within_geofence ? 'Inside' : `${Math.round(r.distance_from_site_m)} m away`}</Badge> },
        { key: 'source', header: 'Source', value: (r) => titleCase(r.source), hideOnMobile: true }, { key: 'flag_reason', header: 'Flags', cell: (r) => r.is_flagged ? <span className="text-xs text-warning">{r.flag_reason}</span> : '' },
      ]} toolbar={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" aria-label="Date" />} />
    </div>
  )
}

export const AssignmentsPage = () => <CrudPage cfg={{
  title: 'Assigned work sites', description: 'Sites appear first in the employee’s site list when they clock in. Employees can still pick other approved sites.',
  table: 'employee_site_assignments', select: '*, employees(first_name, last_name, employee_code), work_sites(name, site_type)', permission: 'field.manage', orgScoped: false, remove: 'delete', orderBy: { column: 'created_at', ascending: false },
  columns: [{ key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` }, { key: 'site', header: 'Site', value: (r) => r.work_sites?.name },
    { key: 'type', header: 'Type', value: (r) => titleCase(r.work_sites?.site_type) }, { key: 'is_primary', header: 'Primary', value: (r) => (r.is_primary ? 'Yes' : '') },
    { key: 'valid_from', header: 'From', cell: (r) => fmtDate(r.valid_from) }, { key: 'valid_to', header: 'To', cell: (r) => fmtDate(r.valid_to) }],
  fields: [{ name: 'employee_id', label: 'Employee', type: 'employee', required: true, wide: true }, { name: 'site_id', label: 'Site', type: 'lookup', lookup: { table: 'work_sites', filter: (q) => q.eq('is_active', true) }, required: true },
    { name: 'is_primary', label: 'Primary site', type: 'switch' }, { name: 'valid_from', label: 'From', type: 'date', required: true }, { name: 'valid_to', label: 'To', type: 'date' }],
}} />

export function SitesPage() {
  const sites = useQuery({ queryKey: ['crud', 'work_sites'], queryFn: () => unwrap<any[]>(db.from('work_sites').select('*')) })
  const approve = useAction((id: string) => unwrap(db.from('work_sites').update({ is_approved: true }).eq('id', id).select('id')), { success: 'Site approved', invalidate: [['crud', 'work_sites'], ['field']] })
  return (
    <div className="space-y-5">
      <CrudPage cfg={{
        title: 'Site management', description: 'Offices, plants and customer sites with geofence radius. Sites added by employees in the field arrive unapproved for review.',
        table: 'work_sites', permission: 'field.manage', orderBy: { column: 'name' }, remove: { column: 'is_active', value: false },
        columns: [{ key: 'name', header: 'Site', cell: (r) => <span>{r.name}{!r.is_approved && <Badge tone="warning" className="ml-1.5">Needs approval</Badge>}{!r.is_active && <Badge className="ml-1.5">Archived</Badge>}</span> },
          { key: 'site_type', header: 'Type', value: (r) => titleCase(r.site_type) }, { key: 'client_name', header: 'Customer', hideOnMobile: true },
          { key: 'coords', header: 'Location', value: (r) => (r.latitude ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}` : 'Not set') }, { key: 'radius_m', header: 'Radius', value: (r) => `${r.radius_m} m` }],
        rowActions: (r) => !r.is_approved && <Button size="sm" variant="success" onClick={() => approve.mutate(r.id)}>Approve</Button>,
        fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'site_type', label: 'Type', type: 'select', required: true, default: 'customer', options: ['office', 'plant', 'customer', 'warehouse', 'other'].map((v) => ({ value: v, label: titleCase(v) })) },
          { name: 'client_name', label: 'Customer name', type: 'text' }, { name: 'address', label: 'Address', type: 'text' },
          { name: 'latitude', label: 'Latitude', type: 'number', min: -90, max: 90, hint: 'Click the map below to copy coordinates' }, { name: 'longitude', label: 'Longitude', type: 'number', min: -180, max: 180 },
          { name: 'radius_m', label: 'Geofence radius (m)', type: 'number', min: 20, max: 5000, default: 200, required: true }, { name: 'is_approved', label: 'Approved', type: 'switch', default: true }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
      }} />
      <Card><CardHeader title="Map" description="Click anywhere to get coordinates for a site." />
        <div className="p-3"><FieldMap sites={(sites.data ?? []).filter((s) => s.latitude).map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude, radius: s.radius_m, name: s.name }))} onPick={(lat, lng) => { navigator.clipboard?.writeText(`${lat}, ${lng}`); toast.message(`Copied ${lat}, ${lng}`) }} /></div>
      </Card>
    </div>
  )
}

export function GpsTrackingPage() {
  const consents = useQuery({ queryKey: ['field', 'consents'], queryFn: () => unwrap<any[]>(db.from('data_consents').select('*, employees(first_name, last_name)').eq('consent_type', 'location').order('granted_at', { ascending: false })) })
  return (
    <div className="space-y-5">
      <PageHeader title="GPS tracking" description="Tracking is consent-based and limited to the working window. Points outside it are rejected by the server; records are purged after the retention period." />
      <SettingsForm section="gps" />
      <Card><CardHeader title="Location consent register" /><div className="p-3"><DataTable rows={consents.data} loading={consents.isLoading} columns={[
        { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` }, { key: 'granted', header: 'Decision', cell: (r) => <Badge tone={r.granted && !r.revoked_at ? 'success' : 'neutral'}>{r.revoked_at ? 'Superseded' : r.granted ? 'Consented' : 'Declined'}</Badge> },
        { key: 'policy_version', header: 'Policy' }, { key: 'granted_at', header: 'Recorded', cell: (r) => fmtDateTime(r.granted_at) },
      ]} /></div></Card>
    </div>
  )
}

export function GeofencingPage() {
  const flagged = useQuery({ queryKey: ['field', 'outside'], queryFn: () => unwrap<any[]>(db.from('attendance_events').select('*, employees(first_name, last_name), work_sites(name)').eq('within_geofence', false).order('occurred_at', { ascending: false }).limit(500)) })
  return (
    <div className="space-y-6">
      <CrudPage cfg={{
        title: 'Geofencing', description: 'Organisation default and per-site rules. "Flag" marks punches outside the radius for HR review; "record" only stores the distance; "off" ignores location. Nothing ever blocks a punch.',
        table: 'geofence_settings', select: '*, work_sites(name)', permission: 'field.manage', remove: 'delete',
        columns: [{ key: 'site', header: 'Applies to', value: (r) => r.work_sites?.name ?? 'All sites (default)' }, { key: 'mode', header: 'Mode', value: (r) => titleCase(r.mode) },
          { key: 'extra_tolerance_m', header: 'Extra tolerance', value: (r) => `${r.extra_tolerance_m} m` }, { key: 'require_accuracy_m', header: 'GPS accuracy needed', value: (r) => `≤ ${r.require_accuracy_m} m` }],
        fields: [{ name: 'site_id', label: 'Site (empty = default)', type: 'lookup', lookup: { table: 'work_sites' } }, { name: 'mode', label: 'Mode', type: 'select', required: true, default: 'flag', options: ['flag', 'record', 'off'].map((v) => ({ value: v, label: titleCase(v) })) },
          { name: 'extra_tolerance_m', label: 'Extra tolerance (m)', type: 'number', min: 0, default: 50, required: true }, { name: 'require_accuracy_m', label: 'Required GPS accuracy (m)', type: 'number', min: 10, default: 150, required: true }],
      }} />
      <Card><CardHeader title="Recent punches outside a geofence" /><div className="p-3"><DataTable rows={flagged.data} loading={flagged.isLoading} exportName="Outside geofence" columns={[
        { key: 'occurred_at', header: 'When', cell: (r) => fmtDateTime(r.occurred_at) }, { key: 'emp', header: 'Employee', value: (r) => `${r.employees?.first_name} ${r.employees?.last_name}` },
        { key: 'site', header: 'Site', value: (r) => r.work_sites?.name }, { key: 'distance', header: 'Distance', value: (r) => `${Math.round(r.distance_from_site_m)} m` }, { key: 'accuracy_m', header: 'GPS accuracy', value: (r) => (r.accuracy_m ? `±${Math.round(r.accuracy_m)} m` : '—') },
      ]} emptyTitle="No punches outside geofences" /></div></Card>
    </div>
  )
}

export function VisitsPage({ mine }: { mine?: boolean }) {
  const { employeeId } = useMe()
  const q = useQuery({ queryKey: ['field', 'visits', mine, employeeId], queryFn: () => { let x = db.from('v_field_visits').select('*').order('check_in_at', { ascending: false }).limit(1000); if (mine) x = x.eq('employee_id', employeeId); return unwrap<any[]>(x) } })
  const sites = useQuery({ queryKey: ['field', 'visit-sites'], enabled: !mine, queryFn: () => unwrap<any[]>(db.from('work_sites').select('id, latitude, longitude, radius_m')) })
  const siteById = useMemo(() => new Map((sites.data ?? []).map((s) => [s.id, s])), [sites.data])
  const where = (r: any) => {
    if (r.check_in_lat == null) return { text: 'No GPS', tone: 'neutral' as const }
    const s = siteById.get(r.site_id)
    if (!s?.latitude) return { text: 'Recorded', tone: 'neutral' as const }
    const d = distanceM(r.check_in_lat, r.check_in_lng, s.latitude, s.longitude)
    return d <= s.radius_m ? { text: 'At site', tone: 'success' as const } : { text: `${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`} from site`, tone: 'warning' as const }
  }
  return (
    <div className="space-y-4">
      {!mine && <PageHeader title="Visit history" description="Customer and site visits logged by field staff." />}
      {mine && <VisitControl />}
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} exportName="Field visits" columns={[
        { key: 'check_in_at', header: 'Started', cell: (r) => fmtDateTime(r.check_in_at) }, ...(!mine ? [{ key: 'employee_name', header: 'Employee' } as any] : []),
        { key: 'site_name', header: 'Site', value: (r) => r.site_name ?? '—' }, { key: 'purpose', header: 'Purpose' }, { key: 'duration_minutes', header: 'Duration', value: (r) => Number(r.duration_minutes), cell: (r) => (r.check_out_at ? minutes(r.duration_minutes) : <Badge tone="info">In progress</Badge>) },
        { key: 'outcome', header: 'Outcome', hideOnMobile: true },
        ...(!mine ? [{ key: 'where', header: 'Check-in location', value: (r: any) => where(r).text, cell: (r: any) => { const w = where(r); return <Badge tone={w.tone}>{w.text}</Badge> } } as any] : []),
      ]} emptyTitle="No visits yet" />
    </div>
  )
}

/** Self-service: start/end a visit and share location only while it runs. */
export function VisitControl() {
  const { employeeId, orgId } = useMe()
  const home = useRpc<any>(['my-home'], 'my_home')
  const open = useQuery({ queryKey: ['field', 'open-visit', employeeId], queryFn: () => unwrap<any>(db.from('field_visits').select('*').eq('employee_id', employeeId).is('check_out_at', null).order('check_in_at', { ascending: false }).limit(1).maybeSingle()) })
  const [startOpen, setStartOpen] = useState(false); const [endOpen, setEndOpen] = useState(false); const [consent, setConsent] = useState(false)
  const [site, setSite] = useState(''); const [purpose, setPurpose] = useState(''); const [outcome, setOutcome] = useState(''); const [notes, setNotes] = useState('')
  const watchRef = useRef<number | null>(null)
  const lastPos = useRef<GeolocationPosition | null>(null)
  const pos = (): Promise<GeolocationPosition | null> => new Promise((r) => {
    const g = navigator.geolocation
    if (!g) return r(lastPos.current)
    g.getCurrentPosition(r, () => g.getCurrentPosition(r, () => r(lastPos.current), { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 }), { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 })
  })
  const visit = open.data
  useEffect(() => {
    if (!visit || !navigator.geolocation || !home.data?.face?.location_consent) return
    let last = 0
    watchRef.current = navigator.geolocation.watchPosition((p) => {
      lastPos.current = p
      if (Date.now() - last < 120_000) return               // at most every 2 minutes
      last = Date.now()
      rpc('record_location_ping', { p_lat: p.coords.latitude, p_lng: p.coords.longitude, p_accuracy: p.coords.accuracy, p_recorded_at: new Date().toISOString(), p_source: 'visit', p_speed: p.coords.speed }).catch(() => undefined)
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 60_000 })
    return () => { if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current) }
  }, [visit?.id, home.data?.face?.location_consent]) // eslint-disable-line
  const start = useAction(async () => {
    const p = await pos()
    lastPos.current = p
    return unwrap(db.from('field_visits').insert({ organisation_id: orgId, employee_id: employeeId, site_id: site || null, purpose, check_in_lat: p?.coords.latitude ?? null, check_in_lng: p?.coords.longitude ?? null }).select('id'))
  }, { success: 'Visit started', invalidate: [['field']], onSuccess: () => { setStartOpen(false); setPurpose(''); if (!lastPos.current) toast.message('Location unavailable — the visit is logged without a check-in location') } })
  const end = useAction(async () => {
    const p = await pos()
    return unwrap(db.from('field_visits').update({ check_out_at: new Date().toISOString(), outcome, notes, check_out_lat: p?.coords.latitude ?? null, check_out_lng: p?.coords.longitude ?? null }).eq('id', visit.id).select('id'))
  }, { success: 'Visit ended', invalidate: [['field']], onSuccess: () => { setEndOpen(false); setOutcome(''); setNotes('') } })
  const sites: any[] = home.data?.sites ?? []
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 font-semibold"><Navigation className="h-4 w-4 text-primary" />{visit ? 'Visit in progress' : 'Field visit'}</div>
        <p className="text-sm text-muted">{visit ? `${visit.purpose} · started ${fmtTime(visit.check_in_at)}${home.data?.face?.location_consent ? ' · sharing location every 2 min' : ''}` : 'Log customer visits. Location is shared only while a visit runs, within working hours.'}</p>
      </div>
      <div className="flex gap-2">
        {!home.data?.face?.location_consent && <Button variant="secondary" onClick={() => setConsent(true)}><ShieldCheck /> Location consent</Button>}
        {visit ? <Button variant="secondary" onClick={() => setEndOpen(true)}><Square /> End visit</Button> : <Button onClick={() => setStartOpen(true)}><Play /> Start visit</Button>}
      </div>
      <Dialog open={startOpen} onOpenChange={setStartOpen} title="Start visit" footer={<Button loading={start.isPending} disabled={!purpose.trim()} onClick={() => start.mutate()}>Start</Button>}>
        <div className="space-y-4">
          <Field label="Site"><Select value={site} onChange={(e) => setSite(e.target.value)}><option value="">Other / not listed</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Purpose" required><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Installation, calibration, demo…" /></Field>
        </div>
      </Dialog>
      <Dialog open={endOpen} onOpenChange={setEndOpen} title="End visit" footer={<Button loading={end.isPending} onClick={() => end.mutate()}>End visit</Button>}>
        <div className="space-y-4"><Field label="Outcome"><Input value={outcome} onChange={(e) => setOutcome(e.target.value)} /></Field><Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </Dialog>
      <ConsentDialog open={consent} onOpenChange={setConsent} type="location" onDone={() => { home.refetch(); navigator.geolocation?.getCurrentPosition((p) => { lastPos.current = p }, () => undefined) }} />
    </Card>
  )
}

export function LocationHistoryPage() {
  const { employeeId } = useMe()
  const { can } = useAuth()
  const [emp, setEmp] = useState<string | null>(employeeId)
  const [date, setDate] = useState(isoDate())
  const q = useQuery({ queryKey: ['field', 'history', emp, date], enabled: !!emp, queryFn: () => unwrap<any[]>(db.from('field_location_records').select('*').eq('employee_id', emp).gte('recorded_at', dayStart(date)).lt('recorded_at', dayStart(date, 1)).order('recorded_at')) })
  const path = (q.data ?? []).map((r) => [r.latitude, r.longitude] as [number, number])
  return (
    <div className="space-y-5">
      <PageHeader title="Location history" description="The route recorded for one employee on one day."
        actions={<>{can(['field.view', 'field.view_team']) && <div className="w-64"><EmployeePicker value={emp} onChange={setEmp} /></div>}<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" /></>} />
      {path.length === 0 ? <Card><EmptyState title="No location points for this day" icon={MapPin} /></Card> : (
        <>
          <FieldMap path={path} points={[{ id: 's', lat: path[0][0], lng: path[0][1], label: 'Start', sub: fmtTime(q.data![0].recorded_at), tone: 'success' }, { id: 'e', lat: path[path.length - 1][0], lng: path[path.length - 1][1], label: 'Latest', sub: fmtTime(q.data![q.data!.length - 1].recorded_at), tone: 'danger' }]} />
          <DataTable rows={q.data} rowKey="id" searchable={false} exportName={`Location history ${date}`} columns={[
            { key: 'recorded_at', header: 'Time', cell: (r) => fmtTime(r.recorded_at) }, { key: 'coords', header: 'Coordinates', value: (r) => `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}` },
            { key: 'accuracy_m', header: 'Accuracy', value: (r) => `±${Math.round(r.accuracy_m ?? 0)} m` }, { key: 'source', header: 'Source', value: (r) => titleCase(r.source) },
          ]} />
        </>
      )}
    </div>
  )
}
