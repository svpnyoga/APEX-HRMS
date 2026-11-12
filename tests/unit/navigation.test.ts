import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NAV } from '@/app/nav'

// Every sidebar entry must resolve to a real route: no dead menus.
describe('navigation', () => {
  const app = readFileSync('src/app/App.tsx', 'utf8')
  const paths = [...app.matchAll(/path: '([^']+)'/g)].map((m) => m[1])
  const patterns = paths.map((p) => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$'))
  it('covers all 14 modules from the specification', () => expect(NAV.map((m) => m.key)).toHaveLength(14))
  for (const m of NAV) for (const i of m.items) {
    it(`${m.label} › ${i.label}`, () => expect(patterns.some((p) => p.test(i.path.split('?')[0]))).toBe(true))
  }
  it('has no excluded modules (CRM, ATS, outsourcing)', () => {
    const labels = NAV.flatMap((m) => [m.label, ...m.items.map((i) => i.label)]).join(' ').toLowerCase()
    for (const banned of ['crm', 'lead', 'quotation', 'invoice', 'candidate', 'recruit', 'applicant', 'outsourc']) expect(labels).not.toContain(banned)
  })
})
