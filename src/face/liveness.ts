import type { FaceFrame } from './types'

/**
 * Active liveness challenge, run alongside passive anti-spoof/liveness models.
 * A printed photo or a replayed video cannot follow a randomised sequence of
 * blink + head-turn prompts in real time. The order is randomised per attempt.
 */
export type ChallengeKind = 'blink' | 'turn'
export type ChallengeState = {
  sequence: ChallengeKind[]
  index: number                // current challenge
  done: boolean
  baselineEar: number | null
  earSamples: number[]
  sawClosed: boolean
  closedAt: number
  turnedA: boolean             // turned one way
  turnedB: boolean             // and the other way
  startedAt: number
  easyTurn: boolean            // one side only, smaller angle
}

/** Faster options (HR switches): one random challenge instead of two; an easier head turn. */
export type ChallengeOptions = { single?: boolean; easyTurn?: boolean }

export const CHALLENGE_TEXT: Record<ChallengeKind, string> = {
  blink: 'Blink slowly',
  turn: 'Turn your head slowly to one side, then the other',
}
export const challengeText = (s: ChallengeState, k: ChallengeKind) => (k === 'turn' && s.easyTurn ? 'Turn your head a little to one side, then back' : CHALLENGE_TEXT[k])

export function newChallenge(opts: ChallengeOptions = {}, rnd = Math.random()): ChallengeState {
  const pair: ChallengeKind[] = rnd < 0.5 ? ['blink', 'turn'] : ['turn', 'blink']
  const sequence = opts.single ? pair.slice(0, 1) : pair                    // still random which one is asked
  return { sequence, index: 0, done: false, baselineEar: null, earSamples: [], sawClosed: false, closedAt: 0, turnedA: false, turnedB: false, startedAt: Date.now(), easyTurn: !!opts.easyTurn }
}

/** Feed a frame; returns the updated state. Pure function — easy to unit test. */
export function stepChallenge(s: ChallengeState, f: FaceFrame, now = Date.now()): ChallengeState {
  if (s.done || f.faceCount !== 1) return s
  const st = { ...s }
  // keep a rolling open-eye baseline from frontal frames
  // (frozen while eyes are closed, and closed-eye samples never lower it)
  if (f.ear !== null && Math.abs(f.yaw) < 0.25 && !st.sawClosed && (st.baselineEar === null || f.ear > st.baselineEar * 0.75)) {
    st.earSamples = [...st.earSamples.slice(-14), f.ear]
    if (st.earSamples.length >= 5) st.baselineEar = st.earSamples.slice().sort((a, b) => b - a)[Math.floor(st.earSamples.length / 3)]
  }
  const current = st.sequence[st.index]
  if (current === 'blink' && st.baselineEar && f.ear !== null) {
    if (!st.sawClosed && f.ear < st.baselineEar * 0.62) { st.sawClosed = true; st.closedAt = now }
    else if (st.sawClosed && f.ear > st.baselineEar * 0.85) {
      if (now - st.closedAt < 1200) return advance(st)        // closed then reopened quickly = blink
      st.sawClosed = false                                     // eyes closed too long: not a natural blink
    }
  }
  if (current === 'turn') {
    const far = st.easyTurn ? 0.2 : 0.32
    if (f.yaw > far) st.turnedA = true
    if (f.yaw < -far) st.turnedB = true
    const turned = st.easyTurn ? st.turnedA || st.turnedB : st.turnedA && st.turnedB
    if (turned && Math.abs(f.yaw) < (st.easyTurn ? 0.12 : 0.2)) return advance(st)   // and back to the front
  }
  return st
}

function advance(s: ChallengeState): ChallengeState {
  const index = s.index + 1
  return { ...s, index, done: index >= s.sequence.length, sawClosed: false, turnedA: false, turnedB: false }
}
