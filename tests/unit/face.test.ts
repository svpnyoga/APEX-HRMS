import { describe, it, expect } from 'vitest'
import { newChallenge, stepChallenge } from '@/face/liveness'
import { assessQuality, median, meanVector } from '@/face/quality'
import { eyeAspectRatio } from '@/face/human-provider'
import type { FaceFrame } from '@/face/types'

const frame = (o: Partial<FaceFrame> = {}): FaceFrame => ({
  faceCount: 1, box: { x: 0.33, y: 0.25, width: 0.34, height: 0.45 }, score: 0.95, embedding: [0], antispoof: 0.9, liveness: 0.9, yaw: 0, pitch: 0, roll: 0, ear: 0.3, ...o,
})

describe('quality gate', () => {
  it('accepts a centred frontal face', () => expect(assessQuality(frame(), 120).ok).toBe(true))
  it('rejects missing, multiple, far, off-centre, dark and turned faces', () => {
    expect(assessQuality(frame({ faceCount: 0, box: null }), 120).issue).toBe('no_face')
    expect(assessQuality(frame({ faceCount: 2 }), 120).issue).toBe('multiple_faces')
    expect(assessQuality(frame({ box: { x: 0.45, y: 0.4, width: 0.1, height: 0.14 } }), 120).issue).toBe('too_far')
    expect(assessQuality(frame({ box: { x: 0.0, y: 0.25, width: 0.3, height: 0.4 } }), 120).issue).toBe('off_centre')
    expect(assessQuality(frame(), 30).issue).toBe('too_dark')
    expect(assessQuality(frame({ yaw: 0.6 }), 120).issue).toBe('not_frontal')
    expect(assessQuality(frame({ yaw: 0.6 }), 120, { requireFrontal: false }).ok).toBe(true)
  })
})

describe('active liveness challenge', () => {
  const run = (seq: ('blink' | 'turn')[], frames: Partial<FaceFrame>[]) => {
    let s = { ...newChallenge(), sequence: seq }
    let t = 0
    for (const f of frames) { s = stepChallenge(s, frame(f), (t += 100)) }
    return s
  }
  const open = Array.from({ length: 8 }, () => ({ ear: 0.3 }))
  it('passes a natural blink then a head turn both ways', () => {
    const s = run(['blink', 'turn'], [...open, { ear: 0.1 }, { ear: 0.29 }, { yaw: 0.4 }, { yaw: 0 }, { yaw: -0.4 }, { yaw: 0.05 }])
    expect(s.done).toBe(true)
  })
  it('does not pass a static photo (no eye or head movement)', () => {
    expect(run(['blink', 'turn'], Array.from({ length: 40 }, () => ({ ear: 0.3 }))).done).toBe(false)
  })
  it('requires turning to both sides, not just one', () => {
    expect(run(['turn', 'blink'], [{ yaw: 0.4 }, { yaw: 0 }, { yaw: 0.45 }, { yaw: 0 }]).index).toBe(0)
  })
  it('rejects eyes closed for too long (not a blink)', () => {
    const closed = Array.from({ length: 20 }, () => ({ ear: 0.08 }))
    expect(run(['blink', 'turn'], [...open, ...closed, { ear: 0.3 }]).index).toBe(0)
  })
  it('ignores frames with more than one face', () => {
    const s = run(['blink', 'turn'], [...open, { ear: 0.1, faceCount: 2 }, { ear: 0.3, faceCount: 2 }])
    expect(s.index).toBe(0)
  })
})

describe('faster challenge options', () => {
  const run = (opts: { single?: boolean; easyTurn?: boolean }, rnd: number, frames: Partial<FaceFrame>[]) => {
    let s = newChallenge(opts, rnd)
    let t = 0
    for (const f of frames) { s = stepChallenge(s, frame(f), (t += 100)) }
    return s
  }
  const open = Array.from({ length: 8 }, () => ({ ear: 0.3 }))
  it('single: only one challenge, still chosen at random', () => {
    expect(newChallenge({ single: true }, 0.1).sequence).toEqual(['blink'])
    expect(newChallenge({ single: true }, 0.9).sequence).toEqual(['turn'])
    expect(newChallenge({}, 0.1).sequence).toHaveLength(2)          // default unchanged
  })
  it('single blink is enough', () => {
    expect(run({ single: true }, 0.1, [...open, { ear: 0.1 }, { ear: 0.29 }]).done).toBe(true)
  })
  it('easy turn: a small turn to one side and back passes', () => {
    expect(run({ single: true, easyTurn: true }, 0.9, [{ yaw: 0.22 }, { yaw: 0.05 }]).done).toBe(true)
  })
  it('easy turn still needs real movement — a still face does not pass', () => {
    expect(run({ single: true, easyTurn: true }, 0.9, Array.from({ length: 30 }, () => ({ yaw: 0.02 }))).done).toBe(false)
  })
  it('normal turn still needs both sides and a bigger angle', () => {
    expect(run({ single: true }, 0.9, [{ yaw: 0.22 }, { yaw: 0.05 }]).done).toBe(false)
  })
})

describe('helpers', () => {
  it('median and mean vector', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(meanVector([[1, 2], [3, 4]])).toEqual([2, 3])
  })
  it('eye aspect ratio from mesh landmarks', () => {
    const mesh = Array.from({ length: 468 }, () => [0, 0, 0])
    mesh[33] = [0, 0, 0]; mesh[133] = [10, 0, 0]; mesh[159] = [5, -1.5, 0]; mesh[145] = [5, 1.5, 0]
    mesh[263] = [30, 0, 0]; mesh[362] = [20, 0, 0]; mesh[386] = [25, -1.5, 0]; mesh[374] = [25, 1.5, 0]
    expect(eyeAspectRatio(mesh)).toBeCloseTo(0.3, 5)
    expect(eyeAspectRatio(undefined)).toBeNull()
  })
})
