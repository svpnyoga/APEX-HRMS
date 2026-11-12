/**
 * Face-recognition provider contract. The app only depends on this interface,
 * so the recogniser can be swapped (e.g. a server-side ArcFace service or a
 * cloud API) without touching attendance screens. Matching itself happens in
 * Postgres (`face_similarity`), keyed by `modelId`, and templates never leave the server.
 */
export type Point = [number, number, number?]

export interface FaceFrame {
  faceCount: number
  box: { x: number; y: number; width: number; height: number } | null    // normalised 0..1
  score: number                       // detector confidence 0..1
  embedding: number[] | null          // descriptor for matching
  antispoof: number | null            // 0..1, higher = real
  liveness: number | null             // 0..1, higher = live
  yaw: number; pitch: number; roll: number   // radians
  ear: number | null                  // eye aspect ratio (avg of both eyes)
}

export interface FaceProvider {
  readonly modelId: string            // stored with every template; similarity is model-specific
  readonly label: string
  load(onProgress?: (msg: string) => void): Promise<void>
  detect(input: HTMLVideoElement): Promise<FaceFrame>
  /** provider-calibrated similarity, used client-side only for quality control */
  similarity(a: number[], b: number[]): number
  dispose(): void
}
