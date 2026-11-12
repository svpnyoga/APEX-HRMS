import { describe, it, expect } from 'vitest'
import { createDb } from './harness'

describe('migrations', () => {
  it('apply cleanly with seed', async () => {
    const db = await createDb()
    const r = await db.query<{ n: number }>('select count(*)::int n from public.employees')
    expect(r.rows[0].n).toBeGreaterThan(5)
  }, 120000)
})
