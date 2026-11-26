import type { FaceFrame, FaceProvider } from './types'

type HumanType = import('@vladmandic/human').Human

/**
 * Default provider: @vladmandic/human (MIT, actively maintained) running on-device via WebGL/WASM.
 *  - BlazeFace detector + 468-point FaceMesh (+ iris) for pose and eye landmarks
 *  - FaceRes descriptor for identity embeddings
 *  - dedicated anti-spoofing and liveness models (passive presentation-attack detection)
 * Combined with an active challenge (blink + head turn) in liveness.ts.
 */
export class HumanFaceProvider implements FaceProvider {
  readonly modelId = 'human-faceres-v1'
  readonly label = 'Human · FaceRes + anti-spoof + liveness (on-device)'
  private human: HumanType | null = null
  private ready: Promise<void> | null = null

  /** Loads once; callers arriving while it is loading (e.g. a scan started during the background preload) share it. */
  load(onProgress?: (msg: string) => void): Promise<void> {
    if (!this.ready) this.ready = this.doLoad(onProgress).catch((e) => { this.ready = null; this.human = null; throw e })
    else onProgress?.('Loading face models…')
    return this.ready
  }

  private async doLoad(onProgress?: (msg: string) => void) {
    onProgress?.('Loading face models…')
    const { Human } = await import('@vladmandic/human')
    const base = (import.meta.env.VITE_FACE_MODEL_BASE as string | undefined) || '/models/'
    this.human = new Human({
      modelBasePath: base,
      backend: 'webgl',
      debug: false,
      async: true,
      warmup: 'none',
      cacheSensitivity: 0,               // never reuse a cached result: each frame is analysed fresh
      filter: { enabled: true, equalization: false, flip: false },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 2, minConfidence: 0.5, return: false },
        mesh: { enabled: true },
        iris: { enabled: true },
        attention: { enabled: false },
        description: { enabled: true, minConfidence: 0.3 },
        emotion: { enabled: false },
        antispoof: { enabled: true },
        liveness: { enabled: true },
      },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
      segmentation: { enabled: false },
    } as any)
    try {
      await this.human.load()
    } catch (e) {
      // WebGL unavailable (old devices / some VMs): fall back to WASM
      onProgress?.('Switching to compatibility mode…')
      this.human.config.backend = 'wasm'
      await this.human.load()
    }
    onProgress?.('Preparing camera analysis…')
    await this.human.warmup()
  }

  async detect(video: HTMLVideoElement): Promise<FaceFrame> {
    if (!this.human) throw new Error('Face models not loaded')
    const res = await this.human.detect(video)
    const faces = res.face ?? []
    const f = faces[0]
    if (!f) return { faceCount: 0, box: null, score: 0, embedding: null, antispoof: null, liveness: null, yaw: 0, pitch: 0, roll: 0, ear: null }
    const ang = f.rotation?.angle ?? { yaw: 0, pitch: 0, roll: 0 }
    return {
      faceCount: faces.length,
      box: { x: f.boxRaw[0], y: f.boxRaw[1], width: f.boxRaw[2], height: f.boxRaw[3] },
      score: f.score ?? 0,
      embedding: f.embedding && f.embedding.length ? Array.from(f.embedding) : null,
      antispoof: f.real ?? null,
      liveness: f.live ?? null,
      yaw: ang.yaw, pitch: ang.pitch, roll: ang.roll,
      ear: eyeAspectRatio(f.mesh as any),
    }
  }

  similarity(a: number[], b: number[]) {
    // same formula as Human.match.similarity defaults and the server's face_similarity('human-faceres-v1')
    let sum = 0
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d }
    const root = Math.sqrt(25 * sum)
    return Math.max(0, Math.min(1, (1 - root / 100 - 0.2) / 0.6))
  }

  dispose() { this.human = null }
}

// FaceMesh landmark indices for eye contours
const L = { top: 159, bottom: 145, outer: 33, inner: 133 }
const R = { top: 386, bottom: 374, outer: 263, inner: 362 }
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function eyeAspectRatio(mesh: number[][] | undefined): number | null {
  if (!mesh || mesh.length < 400) return null
  const one = (e: typeof L) => dist(mesh[e.top], mesh[e.bottom]) / Math.max(1e-6, dist(mesh[e.outer], mesh[e.inner]))
  return (one(L) + one(R)) / 2
}
