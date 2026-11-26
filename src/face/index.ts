import type { FaceProvider } from './types'
import { HumanFaceProvider } from './human-provider'
import { SFaceProvider, SFACE_MODEL_ID } from './sface-provider'

const registry: Record<string, () => FaceProvider> = {
  [SFACE_MODEL_ID]: () => new SFaceProvider(),
  'human-faceres-v1': () => new HumanFaceProvider(),   // retired: the server refuses its codes; kept only for rollback
  // Register additional providers here (e.g. a server-side ArcFace service). They must
  // produce embeddings for a modelId that face_similarity() in Postgres understands.
}

let cached: FaceProvider | null = null
export function getFaceProvider(id: string = SFACE_MODEL_ID): FaceProvider {
  // a settings value from before the switch still gets the current model
  if (id === 'human-faceres-v1' || !registry[id]) id = SFACE_MODEL_ID
  if (cached && cached.modelId === id) return cached
  const make = registry[id]
  if (!make) throw new Error(`Face provider "${id}" is not available in this build`)
  cached = make()
  return cached
}
export const availableProviders = [SFACE_MODEL_ID]   // the retired model is not offered
export type { FaceProvider, FaceFrame } from './types'
