import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LogIn, LogOut, MapPin, ScanFace, WifiOff, CloudUpload, ShieldCheck } from 'lucide-react'
import { rpc } from '@/lib/api'
import { useRpc } from '@/hooks/data'
import { useAuth } from '@/app/auth'
import { FaceScanner, type VerifyCapture } from '@/face/FaceScanner'
import { enqueue, pendingCount, syncQueue } from '@/face/offline-queue'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Badge, Card } from '@/components/ui/misc'
import { Dialog } from '@/components/ui/dialog'
import { cn, errorMessage, fmtTime, minutes } from '@/lib/utils'
import { ConsentDialog } from '@/modules/self/consent'

type Geo = { lat: number; lng: number; accuracy: number; status: 'ok' | 'denied' | 'unavailable' | 'low_accuracy' }

function getPosition(): Promise<Geo> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 0, lng: 0, accuracy: 0, status: 'unavailable' })
    const ok = (p: GeolocationPosition) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, status: p.coords.accuracy > 150 ? 'low_accuracy' : 'ok' })
    const fail = (e: GeolocationPositionError) => resolve({ lat: 0, lng: 0, accuracy: 0, status: e.code === 1 ? 'denied' : 'unavailable' })   // never blocks attendance
    // precise fix first; if that times out, accept a quicker approximate / recent one
    navigator.geolocation.getCurrentPosition(ok, (e) => e.code === 1 ? fail(e)
      : navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 })
  })
}

export function useOfflineSync() {
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const qc = useQueryClient()
  const run = useCallback(async () => {
    const r = await syncQueue()
    if (r.synced) { toast.success(`${r.synced} offline punch${r.synced > 1 ? 'es' : ''} synced`); qc.invalidateQueries({ queryKey: ['my-home'] }) }
    r.messages.forEach((m) => toast.error(m))
    setPending(await pendingCount())
  }, [qc])
  useEffect(() => {
    const refresh = async () => setPending(await pendingCount())
    const on = () => { setOnline(true); run() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('hrms-queue-changed', refresh)
    refresh(); if (navigator.onLine) run()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('hrms-queue-changed', refresh) }
  }, [run])
  return { pending, online, sync: run }
}

export function ClockPanel() {
  const { access } = useAuth()
  const qc = useQueryClient()
  const home = useRpc<any>(['my-home'], 'my_home', undefined, !!access?.employee_id)
  const { pending, online, sync } = useOfflineSync()
  const [scanning, setScanning] = useState(false)
  const [site, setSite] = useState<string>('')
  const [newSite, setNewSite] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const h = home.data
  const settings = h?.settings ?? {}
  const clockedIn = h?.open_session?.event_type === 'in'
  const sites: any[] = h?.sites ?? []
  const assigned = sites.filter((s) => s.assigned)
  useEffect(() => { if (!site && assigned.length) setSite((assigned.find((s) => s.primary) ?? assigned[0]).id) }, [assigned.length]) // eslint-disable-line

  const record = async (capture?: VerifyCapture) => {
    setBusy(true)
    const clientId = crypto.randomUUID()
    const geo = settings.gps_mode === 'off' ? null : await getPosition()
    const base = {
      p_site_id: site && site !== '__new' ? site : null,
      p_new_site_name: site === '__new' ? newSite.trim() || null : null,
      p_lat: geo?.status === 'ok' || geo?.status === 'low_accuracy' ? geo.lat : null,
      p_lng: geo?.status === 'ok' || geo?.status === 'low_accuracy' ? geo.lng : null,
      p_accuracy: geo?.accuracy || null,
      p_gps_status: geo?.status ?? 'disabled',
    }
    const args = capture
      ? { ...base, p_embedding: JSON.stringify(capture.embedding), p_model: capture.modelId, p_antispoof: capture.antispoof, p_liveness: capture.liveness,
          p_challenge_passed: capture.challengePassed, p_quality: capture.quality, p_event_type: clockedIn ? 'out' : 'in' }
      : { ...base, p_event_type: clockedIn ? 'out' : 'in' }
    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const r: any = await rpc(capture ? 'face_clock' : 'clock_event', { ...args, p_client_event_id: clientId })
      if (capture && r.outcome !== 'matched') {
        const why: Record<string, string> = {
          no_match: 'Face did not match your enrolled profile.', spoof_suspected: 'This looked like a photo or screen. Use your live face.',
          liveness_failed: 'Liveness check not passed. Please try again.', not_enrolled: 'Your face is not enrolled yet. Ask HR to enrol you.',
          rate_limited: 'Too many attempts. Please wait or ask HR for manual attendance.', no_consent: 'Biometric consent is needed first.',
        }
        setResult({ tone: 'danger', text: why[r.outcome] ?? 'Verification failed.' })
        if (r.outcome === 'no_consent') setConsentOpen(true)
        return
      }
      const verb = r.event_type === 'in' ? 'Clocked in' : 'Clocked out'
      setResult({ tone: 'success', text: `${verb} at ${fmtTime(r.occurred_at)}${r.is_late && r.event_type === 'in' ? ` · ${r.late_minutes} min late` : ''}` })
      toast.success(verb + (r.flagged ? ` — flagged for review (${r.flag_reason})` : ''))
      qc.invalidateQueries({ queryKey: ['my-home'] }); qc.invalidateQueries({ queryKey: ['attendance'] })
      setTimeout(() => { setScanning(false); setResult(null) }, 2600)
    } catch (e: any) {
      if (e instanceof TypeError || /Failed to fetch|NetworkError/i.test(e?.message ?? '')) {
        await enqueue({ client_event_id: clientId, kind: capture ? 'face' : 'plain', occurred_at: new Date().toISOString(), args })
        setResult({ tone: 'success', text: 'Saved offline — it will sync when you are back online' })
        toast.message('No connection. Your punch is saved securely on this device and will sync automatically.')
        setTimeout(() => { setScanning(false); setResult(null) }, 2600)
      } else {
        setResult({ tone: 'danger', text: errorMessage(e) })
      }
    } finally { setBusy(false) }
  }

  const onCapture = useCallback((c: VerifyCapture) => { record(c) }, [site, newSite, clockedIn, settings.gps_mode]) // eslint-disable-line

  if (!access?.employee_id) return <Card className="p-6 text-sm text-muted">Your login is not linked to an employee record. Ask HR to link it.</Card>
  const today = h?.today
  const faceRequired = !!settings.face_required
  const needsConsent = faceRequired && !h?.face?.consent
  const notEnrolled = faceRequired && h?.face?.status !== 'enrolled'

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Card className="overflow-hidden">
        <div className="bg-ink px-6 py-5 text-white">
          <div className="text-sm text-ink-muted">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div className="figure mt-1 text-5xl font-semibold tnum">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5', clockedIn ? 'bg-[#4ADE80]/20 text-[#86EFAC]' : 'bg-white/10 text-ink-muted')}>
              <span className={cn('h-2 w-2 rounded-full', clockedIn ? 'bg-[#4ADE80]' : 'bg-ink-muted')} />{clockedIn ? `Working since ${fmtTime(h?.open_session?.occurred_at)}` : 'Not clocked in'}
            </span>
            {h?.shift && <span className="text-ink-muted">Shift {fmtTime(h.shift.start_time)}–{fmtTime(h.shift.end_time)} · {h.shift.grace_minutes} min grace</span>}
          </div>
        </div>
        <div className="space-y-4 p-6">
          {!online && <div className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><WifiOff className="h-4 w-4" /> You're offline. Punches are saved on this device and sync automatically.</div>}
          {pending > 0 && (
            <div className="flex items-center justify-between rounded-md bg-info-soft px-3 py-2 text-sm text-info">
              <span className="flex items-center gap-2"><CloudUpload className="h-4 w-4" />{pending} punch{pending > 1 ? 'es' : ''} waiting to sync</span>
              {online && <Button size="sm" variant="secondary" onClick={sync}>Sync now</Button>}
            </div>
          )}
          <Field label="Work site" hint={settings.gps_mode !== 'off' ? 'Location is recorded with your punch if you allow it. Missing GPS never blocks attendance.' : undefined}>
            <Select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Not at a specific site</option>
              {assigned.length > 0 && <optgroup label="Assigned to you">{assigned.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
              {sites.filter((s) => !s.assigned).length > 0 && <optgroup label="Other approved sites">{sites.filter((s) => !s.assigned).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
              {settings.allow_new_site && <option value="__new">+ New site (needs HR approval)</option>}
            </Select>
          </Field>
          {site === '__new' && <Field label="New site name" required><Input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="Customer name and area" /></Field>}

          {needsConsent ? (
            <div className="rounded-lg border border-line p-4 text-sm">
              <p className="font-medium">Face attendance needs your consent</p>
              <p className="mt-1 text-muted">Read how your biometric data is used and stored before continuing.</p>
              <Button className="mt-3" onClick={() => setConsentOpen(true)}><ShieldCheck /> Review and consent</Button>
            </div>
          ) : notEnrolled ? (
            <div className="rounded-lg border border-line p-4 text-sm"><p className="font-medium">Face not enrolled</p><p className="mt-1 text-muted">HR enrols your face once, in person, using several samples. Until then, ask HR for manual attendance.</p></div>
          ) : (
            <Button size="lg" className="w-full" variant={clockedIn ? 'secondary' : 'primary'} loading={busy}
              disabled={site === '__new' && !newSite.trim()}
              onClick={() => (faceRequired ? (setResult(null), setScanning(true)) : record())}>
              {faceRequired && <ScanFace />}{clockedIn ? <><LogOut /> Clock out</> : <><LogIn /> Clock in</>}
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-semibold">Today</h3>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div><dt className="text-xs text-muted">First in</dt><dd className="figure text-2xl">{fmtTime(today?.first_in)}</dd></div>
          <div><dt className="text-xs text-muted">Last out</dt><dd className="figure text-2xl">{fmtTime(today?.last_out)}</dd></div>
          <div><dt className="text-xs text-muted">Worked</dt><dd className="figure text-2xl">{minutes(today?.worked_minutes)}</dd></div>
          <div><dt className="text-xs text-muted">Status</dt><dd className="mt-1 flex flex-wrap gap-1">
            {today ? <><Badge tone={today.status === 'present' ? 'success' : 'neutral'}>{today.status?.replace('_', ' ')}</Badge>{today.is_late && <Badge tone="warning">Late {today.late_minutes}m</Badge>}{today.missing_checkout && <Badge tone="danger">Missing check-out</Badge>}</> : <Badge>Not started</Badge>}
          </dd></div>
        </dl>
        <div className="mt-6 rounded-lg bg-raised p-4 text-xs text-muted">
          <p className="flex items-center gap-1.5 font-medium text-text"><ShieldCheck className="h-4 w-4 text-success" /> How face check-in works</p>
          <p className="mt-1.5">Your camera image is analysed on this device. Only a numeric face descriptor is sent, and it is matched on the server against templates HR enrolled. A blink and head-turn check plus anti-spoofing models stop photos and videos. Every attempt is logged.</p>
        </div>
      </Card>

      <Dialog open={scanning} onOpenChange={(o) => { if (!busy) setScanning(o) }} title={clockedIn ? 'Clock out' : 'Clock in'} description="Follow the prompts. This takes about 5 seconds." size="md">
        {scanning && (
          <FaceScanner mode="verify" providerId={settings.face_provider} thresholds={{ antispoof: Number(settings.antispoof_threshold ?? 0.5), liveness: Number(settings.liveness_threshold ?? 0.5) }}
            onVerify={onCapture} resultLabel={result} />
        )}
        <p className="mt-3 text-center text-xs text-muted">Trouble with the camera? Submit an attendance regularisation request or ask HR for manual attendance.</p>
      </Dialog>
      <ConsentDialog open={consentOpen} onOpenChange={setConsentOpen} type="biometric" onDone={() => home.refetch()} />
    </div>
  )
}

/** Shared, supervised kiosk: 1:N identification. Signed in with a kiosk-role account. */
export function KioskPage() {
  const [key, setKey] = useState(0)
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const onVerify = useCallback(async (c: VerifyCapture) => {
    try {
      const r: any = await rpc('kiosk_identify_clock', { p_embedding: JSON.stringify(c.embedding), p_model: c.modelId, p_antispoof: c.antispoof, p_liveness: c.liveness, p_challenge_passed: c.challengePassed, p_quality: c.quality })
      if (r.outcome === 'matched') setResult({ tone: 'success', text: `${r.employee_name} · ${r.event_type === 'in' ? 'clocked in' : 'clocked out'} at ${fmtTime(r.occurred_at)}` })
      else setResult({ tone: 'danger', text: r.outcome === 'no_match' ? 'Not recognised. Please see HR.' : 'Check failed. Please try again.' })
    } catch (e) { setResult({ tone: 'danger', text: errorMessage(e) }) }
    setTimeout(() => { setResult(null); setKey((k) => k + 1) }, 3500)
  }, [])
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-ink p-6">
      <h1 className="mb-1 text-2xl font-semibold text-white">Face attendance</h1>
      <p className="mb-6 text-sm text-ink-muted">Stand in front of the camera and follow the prompts</p>
      <div className="w-full max-w-lg"><FaceScanner key={key} mode="verify" onVerify={onVerify} resultLabel={result} /></div>
    </div>
  )
}

export function SiteBadge({ name }: { name?: string | null }) {
  return name ? <span className="inline-flex items-center gap-1 text-xs text-muted"><MapPin className="h-3 w-3" />{name}</span> : null
}
