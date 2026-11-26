import type { FaceFrame, FaceProvider } from './types'
import { eyeAspectRatio } from './human-provider'

type HumanType = import('@vladmandic/human').Human
type Ort = typeof import('onnxruntime-web/wasm')

/**
 * Default provider.
 *  - @vladmandic/human (MIT) finds the face: BlazeFace + 468-point FaceMesh (+ iris) for pose, blink and landmarks,
 *    plus its anti-spoofing and liveness models.
 *  - SFace (OpenCV Zoo, Apache-2.0; MobileFaceNet trained for face verification) turns the face into a 128-number
 *    identity code. The face is first aligned to the standard 112x112 position using five landmarks (eyes, nose
 *    tip, mouth corners), which is what the model expects.
 * Human's own "faceres" descriptor is NOT used: it is not built to tell people apart and accepted look-alikes.
 */
export const SFACE_MODEL_ID = 'sface-2021dec-v1'

// standard 5-point positions in a 112x112 aligned face (left eye, right eye, nose tip, mouth left, mouth right; image coordinates)
const TEMPLATE: [number, number][] = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]]

/** cosine similarity mapped to 0..1 exactly like the server's face_similarity('sface…'): (cos - 0.15) / 0.40 */
export function sfaceScore(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const cos = na && nb ? d / Math.sqrt(na * nb) : 0
  return Math.max(0, Math.min(1, (cos - 0.15) / 0.4))
}

/**
 * Least-squares similarity transform taking each output (template) point to its input (image) point,
 * in the 8-number form tf.image.transform expects: input = [a -b; b a]·output + t.
 */
export function alignTransform(src: [number, number][], dst: [number, number][] = TEMPLATE): number[] {
  const n = src.length
  let mx = 0, my = 0, ux = 0, uy = 0
  for (let i = 0; i < n; i++) { mx += dst[i][0]; my += dst[i][1]; ux += src[i][0]; uy += src[i][1] }
  mx /= n; my /= n; ux /= n; uy /= n
  let a = 0, b = 0, d = 0
  for (let i = 0; i < n; i++) {
    const x = dst[i][0] - mx, y = dst[i][1] - my, u = src[i][0] - ux, v = src[i][1] - uy
    a += x * u + y * v; b += x * v - y * u; d += x * x + y * y
  }
  a /= d; b /= d
  return [a, -b, ux - a * mx + b * my, b, a, uy - b * mx - a * my, 0, 0]
}

const mid = (m: number[][], i: number, j: number): [number, number] => [(m[i][0] + m[j][0]) / 2, (m[i][1] + m[j][1]) / 2]
/** five landmarks from FaceMesh, in image order: image-left eye (subject's right), image-right eye, nose tip, mouth corners */
export function fivePoints(mesh: number[][]): [number, number][] {
  const p: [number, number][] = [mid(mesh, 33, 133), mid(mesh, 263, 362), [mesh[4][0], mesh[4][1]], [mesh[61][0], mesh[61][1]], [mesh[291][0], mesh[291][1]]]
  return p[0][0] <= p[1][0] ? p : [p[1], p[0], p[2], p[4], p[3]]
}

export class SFaceProvider implements FaceProvider {
  readonly modelId = SFACE_MODEL_ID
  readonly label = 'SFace identity + Human anti-spoof & liveness (on-device)'
  private human: HumanType | null = null
  private ort: Ort | null = null
  private session: import('onnxruntime-web').InferenceSession | null = null
  private ready: Promise<void> | null = null

  load(onProgress?: (msg: string) => void): Promise<void> {
    if (!this.ready) this.ready = this.doLoad(onProgress).catch((e) => { this.ready = null; this.human = null; this.session = null; throw e })
    else onProgress?.('Loading face models…')
    return this.ready
  }

  private async doLoad(onProgress?: (msg: string) => void) {
    onProgress?.('Loading face models…')
    const base = (import.meta.env.VITE_FACE_MODEL_BASE as string | undefined) || '/models/'
    const [{ Human }, ort] = await Promise.all([import('@vladmandic/human'), import('onnxruntime-web/wasm')])
    ort.env.wasm.wasmPaths = '/ort/'
    ort.env.wasm.numThreads = 1          // no cross-origin isolation needed
    ort.env.logLevel = 'error'
    this.ort = ort
    this.human = new Human({
      modelBasePath: base,
      backend: 'webgl',
      debug: false,
      async: true,
      warmup: 'none',
      cacheSensitivity: 0,
      filter: { enabled: true, equalization: false, flip: false },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 2, minConfidence: 0.5, return: false },
        mesh: { enabled: true },
        iris: { enabled: true },
        attention: { enabled: false },
        description: { enabled: false },   // identity comes from SFace
        emotion: { enabled: false },
        antispoof: { enabled: true },
        liveness: { enabled: true },
      },
      body: { enabled: false }, hand: { enabled: false }, object: { enabled: false }, gesture: { enabled: false },
      segmentation: { enabled: false },
    } as any)
    const sessionP = ort.InferenceSession.create(`${base}sface_2021dec_int8.onnx`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    try {
      await this.human.load()
    } catch {
      onProgress?.('Switching to compatibility mode…')
      this.human.config.backend = 'wasm'
      await this.human.load()
    }
    this.session = await sessionP
    onProgress?.('Preparing camera analysis…')
    await this.human.warmup()
  }

  async detect(video: HTMLVideoElement): Promise<FaceFrame> {
    if (!this.human || !this.session || !this.ort) throw new Error('Face models not loaded')
    const tf = this.human.tf as any
    // one frame tensor for both detection and the identity crop, so landmarks and pixels are from the same instant
    const frame = tf.browser.fromPixels(video)
    try {
      const res = await this.human.detect(frame)
      const faces = res.face ?? []
      const f = faces[0]
      if (!f) return { faceCount: 0, box: null, score: 0, embedding: null, antispoof: null, liveness: null, yaw: 0, pitch: 0, roll: 0, ear: null }
      const ang = (f.rotation?.angle ?? { yaw: 0, pitch: 0, roll: 0 }) as any
      let embedding: number[] | null = null
      if (faces.length === 1 && f.mesh && f.mesh.length >= 400) embedding = await this.embed(tf, frame, fivePoints(f.mesh as any))
      return {
        faceCount: faces.length,
        box: { x: f.boxRaw[0], y: f.boxRaw[1], width: f.boxRaw[2], height: f.boxRaw[3] },
        score: f.score ?? 0,
        embedding,
        antispoof: f.real ?? null,
        liveness: f.live ?? null,
        yaw: ang.yaw, pitch: ang.pitch, roll: ang.roll,
        ear: eyeAspectRatio(f.mesh as any),
      }
    } finally {
      tf.dispose(frame)
    }
  }

  private async embed(tf: any, frame: any, pts: [number, number][]): Promise<number[]> {
    const aligned = tf.tidy(() => tf.image.transform(tf.expandDims(tf.cast(frame, 'float32'), 0), tf.tensor2d([alignTransform(pts)], [1, 8]), 'bilinear', 'constant', 0, [112, 112]))
    const hwc: Float32Array = await aligned.data()
    tf.dispose(aligned)
    const S = 112 * 112, chw = new Float32Array(3 * S)
    for (let k = 0; k < S; k++) { chw[k] = hwc[k * 3]; chw[S + k] = hwc[k * 3 + 1]; chw[2 * S + k] = hwc[k * 3 + 2] }   // RGB, 0..255, NCHW
    const s = this.session!
    const out = await s.run({ [s.inputNames[0]]: new this.ort!.Tensor('float32', chw, [1, 3, 112, 112]) })
    return Array.from(out[s.outputNames[0]].data as Float32Array)
  }

  similarity(a: number[], b: number[]) { return sfaceScore(a, b) }

  dispose() { this.human = null; this.session = null }
}
