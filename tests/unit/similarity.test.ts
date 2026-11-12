import { describe, it, expect, vi } from 'vitest'
vi.mock('@vladmandic/human', () => ({}))
import { HumanFaceProvider } from '@/face/human-provider'

// Client QC must agree with the server's face_similarity('human-faceres-v1') formula.
const server = (a: number[], b: number[]) => {
  const l2 = Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0))
  return Math.max(0, Math.min(1, (0.8 - l2 / 20) / 0.6))
}
describe('similarity parity', () => {
  it('matches the database formula', () => {
    const p = new HumanFaceProvider()
    for (let k = 0; k < 20; k++) {
      const a = Array.from({ length: 64 }, () => Math.random())
      const b = a.map((x) => x + (Math.random() - 0.5) * k * 0.3)
      expect(p.similarity(a, b)).toBeCloseTo(server(a, b), 6)
    }
  })
  it('identical descriptors are a perfect match', () => {
    const v = Array.from({ length: 1024 }, () => Math.random())
    expect(new HumanFaceProvider().similarity(v, v)).toBe(1)
  })
})
