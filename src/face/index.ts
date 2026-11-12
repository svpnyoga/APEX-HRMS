import type { FaceProvider } from './types'
import { HumanFaceProvider } from './human-provider'

const registry: Record<string, () => FaceProvider> = {
  'human-faceres-v1': () => new HumanFaceProvider(),
  // Register additional providers here (e.g. a server-side ArcFace service). They must
  // produce embeddings for a modelId that face_similarity() in Postgres understands.
}

let cached: FaceProvider | null = null
export function getFaceProvider(id = 'human-faceres-v1'): FaceProvider {
  if (cached && cached.modelId === id) return cached
  const make = registry[id]
  if (!make) throw new Error(`Face provider "${id}" is not available in this build`)
  cached = make()
  return cached
}
export const availableProviders = Object.keys(registry)
export type { FaceProvider, FaceFrame } from './types'
