import { describe, it, expect } from 'vitest'
import { alignTransform, fivePoints } from '../../src/face/sface-provider'

const apply = (t: number[], [x, y]: number[]) => [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]]
const T = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]]

describe('SFace alignment', () => {
  it('maps the 112x112 template onto a scaled, rotated, shifted face', () => {
    const ang = 0.3, s = 2.5, tx = 140, ty = 60
    const src = T.map(([x, y]) => [s * (Math.cos(ang) * x - Math.sin(ang) * y) + tx, s * (Math.sin(ang) * x + Math.cos(ang) * y) + ty]) as [number, number][]
    const t = alignTransform(src)
    T.forEach((p, i) => { const q = apply(t, p); expect(q[0]).toBeCloseTo(src[i][0], 6); expect(q[1]).toBeCloseTo(src[i][1], 6) })
  })
  it('orders the eyes and mouth corners left-to-right in the image', () => {
    const mesh = Array.from({ length: 468 }, () => [0, 0])
    const set = (i: number, x: number, y: number) => { mesh[i] = [x, y] }
    set(33, 200, 100); set(133, 180, 100); set(263, 100, 100); set(362, 120, 100); set(4, 150, 140); set(61, 190, 180); set(291, 110, 180)
    const p = fivePoints(mesh)
    expect(p[0][0]).toBeLessThan(p[1][0])
    expect(p[3][0]).toBeLessThan(p[4][0])
  })
})
