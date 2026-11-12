import type { FaceFrame } from './types'

export type QualityIssue = 'no_face' | 'multiple_faces' | 'too_far' | 'too_close' | 'off_centre' | 'not_frontal' | 'low_confidence' | 'too_dark' | 'too_bright'

export const QUALITY_MESSAGES: Record<QualityIssue, string> = {
  no_face: 'Position your face inside the ring',
  multiple_faces: 'Only one person should be in view',
  too_far: 'Move a little closer',
  too_close: 'Move back slightly',
  off_centre: 'Centre your face in the ring',
  not_frontal: 'Look straight at the camera',
  low_confidence: 'Hold still in good light',
  too_dark: 'More light needed on your face',
  too_bright: 'Too much light behind or on you',
}

export type QualityResult = { ok: boolean; issue: QualityIssue | null; score: number }

/** Gate frames before they are used for enrolment or matching. */
export function assessQuality(f: FaceFrame, brightness: number | null, opts: { requireFrontal?: boolean } = {}): QualityResult {
  const requireFrontal = opts.requireFrontal ?? true
  if (f.faceCount === 0 || !f.box) return { ok: false, issue: 'no_face', score: 0 }
  if (f.faceCount > 1) return { ok: false, issue: 'multiple_faces', score: 0 }
  const w = f.box.width
  if (w < 0.22) return { ok: false, issue: 'too_far', score: 0.2 }
  if (w > 0.75) return { ok: false, issue: 'too_close', score: 0.3 }
  const cx = f.box.x + f.box.width / 2, cy = f.box.y + f.box.height / 2
  if (Math.abs(cx - 0.5) > 0.18 || Math.abs(cy - 0.5) > 0.22) return { ok: false, issue: 'off_centre', score: 0.3 }
  if (brightness !== null && brightness < 55) return { ok: false, issue: 'too_dark', score: 0.3 }
  if (brightness !== null && brightness > 215) return { ok: false, issue: 'too_bright', score: 0.3 }
  if (requireFrontal && (Math.abs(f.yaw) > 0.3 || Math.abs(f.pitch) > 0.3)) return { ok: false, issue: 'not_frontal', score: 0.5 }
  if (f.score < 0.75) return { ok: false, issue: 'low_confidence', score: 0.5 }
  const frontal = 1 - Math.min(1, (Math.abs(f.yaw) + Math.abs(f.pitch)) / 0.6)
  const size = Math.min(1, w / 0.4)
  const score = Math.round((0.45 * f.score + 0.3 * frontal + 0.25 * size) * 1000) / 1000
  return { ok: true, issue: null, score }
}

/** Mean luma of the central region of the frame (0..255). */
export function frameBrightness(video: HTMLVideoElement, canvas: HTMLCanvasElement): number | null {
  const w = 64, h = 48
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx || !video.videoWidth) return null
  ctx.drawImage(video, video.videoWidth * 0.25, video.videoHeight * 0.2, video.videoWidth * 0.5, video.videoHeight * 0.6, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  return sum / (d.length / 4)
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const meanVector = (vs: number[][]) => {
  const out = new Array(vs[0].length).fill(0)
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length
  return out
}
