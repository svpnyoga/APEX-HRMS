import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getFaceProvider } from './index'
import type { FaceFrame } from './types'
import { assessQuality, frameBrightness, meanVector, median, QUALITY_MESSAGES } from './quality'
import { challengeText, newChallenge, stepChallenge, type ChallengeOptions, type ChallengeState } from './liveness'

export type VerifyCapture = { embedding: number[]; antispoof: number; liveness: number; challengePassed: boolean; quality: number; modelId: string }
export type EnrolCapture = { embeddings: number[][]; qualities: number[]; modelId: string }

type Phase = 'idle' | 'loading' | 'align' | 'challenge' | 'capture' | 'done' | 'error' | 'timeout'
type Props = {
  mode: 'verify' | 'enrol'
  providerId?: string
  thresholds?: { antispoof: number; liveness: number }
  samples?: number
  onVerify?: (c: VerifyCapture) => void
  onEnrol?: (c: EnrolCapture) => void
  autoStart?: boolean
  compact?: boolean
  resultLabel?: { tone: 'success' | 'danger'; text: string } | null
  /** Faster check options; `skip` is asked once the face is aligned — when it returns true the blink/turn step is
   *  skipped and reported as not done (the server decides whether that is allowed, e.g. inside the office). */
  liveness?: ChallengeOptions & { skip?: () => boolean }
}

const ENROL_POSES = [
  { text: 'Look straight at the camera', yaw: [-0.15, 0.15] },
  { text: 'Turn very slightly to one side', yaw: [0.12, 0.38], either: true },
  { text: 'Now slightly to the other side', yaw: [-0.38, -0.12], either: true },
  { text: 'Tilt your chin up a little', pitch: [-0.4, -0.08], either: true },
  { text: 'Look straight again', yaw: [-0.15, 0.15] },
  { text: 'Hold still — one more', yaw: [-0.15, 0.15] },
  { text: 'Last one', yaw: [-0.15, 0.15] },
] as const

const TIMEOUT_MS = 60_000

export function FaceScanner({ mode, providerId, thresholds = { antispoof: 0.5, liveness: 0.5 }, samples = 5, onVerify, onEnrol, autoStart = true, compact, resultLabel, liveness }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const livenessRef = useRef(liveness)
  livenessRef.current = liveness
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const streamRef = useRef<MediaStream | null>(null)
  const runRef = useRef(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('Starting camera…')
  const [frame, setFrame] = useState<FaceFrame | null>(null)
  const [progress, setProgress] = useState(0)
  const [challenge, setChallenge] = useState<ChallengeState | null>(null)
  const [error, setError] = useState<string | null>(null)

  // phase state + a ref so the rAF loop always reads the latest value
  const setPhaseRef = useRef<Phase>('idle')
  const setPhaseState = (p: Phase) => { setPhaseRef.current = p; setPhase(p) }

  const stop = useCallback(() => {
    runRef.current++
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    const run = ++runRef.current
    setError(null); setProgress(0); setChallenge(null)
    setPhaseState('loading'); setMessage('Starting camera…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access a camera. Use a recent Chrome, Edge, Safari or Firefox over HTTPS.')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      if (run !== runRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      const v = videoRef.current!
      v.srcObject = stream
      await v.play()
      const provider = getFaceProvider(providerId)
      await provider.load((m) => setMessage(m))
      if (run !== runRef.current) return

      const started = Date.now()
      let stablesince = 0
      let ch = newChallenge()
      let anchor: number[] | null = null
      let skipped = false
      const captured: { e: number[]; a: number; l: number; q: number }[] = []
      let pose = 0
      let lastCapture = 0
      setPhaseState('align'); setMessage('Position your face inside the ring')

      const loop = async () => {
        if (run !== runRef.current) return
        if (Date.now() - started > TIMEOUT_MS) { setPhaseState('timeout'); setMessage('That took too long. Try again in better light.'); stop(); return }
        let f: FaceFrame
        try { f = await provider.detect(v) } catch { requestAnimationFrame(loop); return }
        if (run !== runRef.current) return
        setFrame(f)
        const bright = frameBrightness(v, canvasRef.current)
        const phaseNow = setPhaseRef.current
        const wantFrontal = phaseNow !== 'challenge' && !(mode === 'enrol' && phaseNow === 'capture' && pose > 0 && pose < 4)
        const qual = assessQuality(f, bright, { requireFrontal: wantFrontal })

        if (phaseNow === 'align') {
          if (!qual.ok) { stablesince = 0; setMessage(QUALITY_MESSAGES[qual.issue!]); setProgress(0) }
          else {
            stablesince ||= Date.now()
            const held = Date.now() - stablesince
            setProgress(Math.min(20, held / 30))
            setMessage('Hold still…')
            if (held > 600 && f.embedding) {
              anchor = f.embedding
              ch = newChallenge(mode === 'verify' ? livenessRef.current : undefined); setChallenge(ch)
              if (mode === 'verify' && livenessRef.current?.skip?.()) { skipped = true; ch = { ...ch, done: true }; setPhaseState('capture'); setMessage('Look straight at the camera') }
              else { setPhaseState('challenge'); setMessage(challengeText(ch, ch.sequence[0])) }
            }
          }
        } else if (phaseNow === 'challenge') {
          if (f.faceCount !== 1) setMessage(QUALITY_MESSAGES[f.faceCount ? 'multiple_faces' : 'no_face'])
          else {
            ch = stepChallenge(ch, f)
            setChallenge(ch)
            setProgress(20 + (ch.index / ch.sequence.length) * 40)
            if (ch.done) { setPhaseState('capture'); setMessage(mode === 'enrol' ? ENROL_POSES[0].text : 'Look straight at the camera') }
            else setMessage(challengeText(ch, ch.sequence[ch.index]))
          }
        } else if (phaseNow === 'capture') {
          const target = mode === 'enrol' ? Math.max(samples, 5) : 4
          const p = ENROL_POSES[Math.min(pose, ENROL_POSES.length - 1)] as any
          let poseOk = true
          if (mode === 'enrol') {
            const inRange = (v: number, r?: readonly number[]) => !r || (v >= r[0] && v <= r[1]) || (p.either && v >= -r[1] && v <= -r[0])
            poseOk = inRange(f.yaw, p.yaw) && inRange(f.pitch, p.pitch)
            setMessage(qual.ok && !poseOk ? p.text : qual.ok ? p.text : QUALITY_MESSAGES[qual.issue!])
          } else if (!qual.ok) setMessage(QUALITY_MESSAGES[qual.issue!])
          // identity must stay the same person who started the challenge
          if (qual.ok && poseOk && f.embedding && anchor && provider.similarity(anchor, f.embedding) < 0.45) {
            setPhaseState('error'); setError('The face changed during the check. Please try again.'); stop(); return
          }
          if (qual.ok && poseOk && f.embedding && f.antispoof !== null && f.liveness !== null && Date.now() - lastCapture > (mode === 'enrol' ? 450 : 120)) {
            if (f.antispoof < thresholds.antispoof) { setMessage('Use your real face — screens and photos are not accepted') }
            else {
              captured.push({ e: f.embedding, a: f.antispoof, l: f.liveness, q: qual.score })
              lastCapture = Date.now()
              pose++
              setProgress(60 + (captured.length / target) * 40)
            }
          }
          if (captured.length >= target) {
            stop()
            setPhaseState('done')
            if (mode === 'verify') {
              onVerify?.({
                embedding: meanVector(captured.map((c) => c.e)),
                antispoof: median(captured.map((c) => c.a)),
                liveness: median(captured.map((c) => c.l)),
                challengePassed: ch.done && !skipped,
                quality: median(captured.map((c) => c.q)),
                modelId: provider.modelId,
              })
            } else {
              // enrolment consistency: every sample must match every other sample
              let minSim = 1
              for (let i = 0; i < captured.length; i++) for (let j = i + 1; j < captured.length; j++) minSim = Math.min(minSim, provider.similarity(captured[i].e, captured[j].e))
              if (minSim < 0.55) { setPhaseState('error'); setError('Samples were not consistent (lighting or movement). Please retake.'); return }
              onEnrol?.({ embeddings: captured.map((c) => c.e), qualities: captured.map((c) => c.q), modelId: provider.modelId })
            }
            return
          }
        }
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    } catch (e: any) {
      const msg = e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.'
        : e?.name === 'NotFoundError' ? 'No camera was found on this device.'
        : e?.name === 'NotReadableError' ? 'The camera is being used by another app.'
        : e?.message || 'Could not start face recognition.'
      setError(msg); setPhaseState('error'); stop()
    }
  }, [mode, providerId, samples, thresholds.antispoof, onVerify, onEnrol, stop])

  useEffect(() => { if (autoStart) start(); return stop }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const yawDeg = Math.round(((frame?.yaw ?? 0) * 180) / Math.PI)
  const pitchDeg = Math.round(((frame?.pitch ?? 0) * 180) / Math.PI)
  const active = ['align', 'challenge', 'capture'].includes(phase)
  const ok = phase === 'done'
  const failed = phase === 'error' || phase === 'timeout'
  const R = 43, C = 2 * Math.PI * R

  return (
    <div className={cn('relative mx-auto w-full overflow-hidden rounded-2xl bg-[#060B18] text-white', compact ? 'max-w-sm' : 'max-w-lg')}>
      <div className="relative aspect-[4/5] w-full sm:aspect-[4/3.6]">
        <video ref={videoRef} playsInline muted className={cn('absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity', active || phase === 'loading' ? 'opacity-100' : 'opacity-40')} />
        {/* calibration reticle */}
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
          <defs>
            <mask id="hole"><rect width="100" height="100" fill="white" /><ellipse cx="50" cy="50" rx="26" ry="33" fill="black" /></mask>
          </defs>
          <rect width="100" height="100" fill="#060B18" opacity="0.55" mask="url(#hole)" />
          <ellipse cx="50" cy="50" rx="26" ry="33" fill="none" stroke={ok ? '#4ADE80' : failed ? '#F87171' : 'rgb(var(--scan))'} strokeOpacity={active ? 0.9 : 0.5} strokeWidth="0.6" />
          {Array.from({ length: 72 }).map((_, i) => {
            const a = (i / 72) * Math.PI * 2
            const major = i % 6 === 0
            const r1 = R, r2 = R + (major ? 3 : 1.5)
            return <line key={i} x1={50 + Math.cos(a) * r1} y1={50 + Math.sin(a) * r1} x2={50 + Math.cos(a) * r2} y2={50 + Math.sin(a) * r2}
              stroke="white" strokeOpacity={major ? 0.55 : 0.22} strokeWidth={major ? 0.45 : 0.3} />
          })}
          <circle cx="50" cy="50" r={R} fill="none" stroke={ok ? '#4ADE80' : 'rgb(var(--scan))'} strokeWidth="1.2" strokeLinecap="round"
            strokeDasharray={`${(progress / 100) * C} ${C}`} transform="rotate(-90 50 50)" style={{ transition: 'stroke-dasharray .2s' }} />
          {active && <line x1={50 - 3} y1="50" x2={50 + 3} y2="50" stroke="white" strokeOpacity=".4" strokeWidth=".3" />}
          {active && <line x1="50" y1={50 - 3} x2="50" y2={50 + 3} stroke="white" strokeOpacity=".4" strokeWidth=".3" />}
        </svg>

        {active && frame && frame.faceCount > 0 && (
          <div className="absolute left-3 top-3 rounded-md bg-black/45 px-2 py-1 font-figure text-[11px] leading-tight text-white/80 tnum">
            <div>yaw {yawDeg > 0 ? '+' : ''}{yawDeg}°</div><div>pitch {pitchDeg > 0 ? '+' : ''}{pitchDeg}°</div>
          </div>
        )}
        {challenge && (phase === 'challenge' || phase === 'capture') && (
          <div className="absolute right-3 top-3 flex gap-1">
            {challenge.sequence.map((s, i) => (
              <span key={s} className={cn('rounded-full px-2 py-0.5 text-[11px]', i < challenge.index || challenge.done ? 'bg-[#4ADE80]/90 text-black' : i === challenge.index ? 'bg-white text-black' : 'bg-white/20')}>
                {s === 'blink' ? 'Blink' : 'Turn'}
              </span>
            ))}
          </div>
        )}

        {(ok || failed || phase === 'idle') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {ok && !resultLabel && <><CheckCircle2 className="h-12 w-12 text-[#4ADE80]" /><p className="text-sm text-white/80">{mode === 'enrol' ? 'Samples captured' : 'Verifying…'}</p></>}
            {ok && resultLabel && (resultLabel.tone === 'success'
              ? <><CheckCircle2 className="h-12 w-12 text-[#4ADE80]" /><p className="max-w-xs text-base font-medium">{resultLabel.text}</p></>
              : <><XCircle className="h-12 w-12 text-[#F87171]" /><p className="max-w-xs text-base font-medium">{resultLabel.text}</p></>)}
            {failed && <><ShieldAlert className="h-11 w-11 text-[#F87171]" /><p className="max-w-xs text-sm text-white/90">{error ?? message}</p></>}
            {phase === 'idle' && <Camera className="h-10 w-10 text-white/60" />}
            {(failed || phase === 'idle' || (ok && resultLabel?.tone === 'danger')) && (
              <Button variant="secondary" onClick={start} className="mt-1 border-white/20 bg-white/10 text-white hover:bg-white/20"><RefreshCw /> {phase === 'idle' ? 'Start camera' : 'Try again'}</Button>
            )}
          </div>
        )}
      </div>
      <div className="flex min-h-[52px] items-center justify-center border-t border-white/10 px-4 py-3 text-center text-[15px] font-medium" role="status" aria-live="polite">
        {phase === 'loading' ? <span className="text-white/70">{message}</span> : active ? message : ok ? (resultLabel ? (resultLabel.tone === 'success' ? 'Done' : 'Not verified') : 'Done') : failed ? 'Check failed' : 'Ready'}
      </div>
    </div>
  )
}
