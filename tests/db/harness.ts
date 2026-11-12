import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..', '..')

export async function createDb({ seed = true } = {}) {
  const db = new PGlite({ extensions: { vector, pgcrypto } })
  await db.exec(readFileSync(join(__dirname, 'supabase-stub.sql'), 'utf8'))
  const dir = join(root, 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`)
    }
  }
  if (seed) {
    try {
      await db.exec(readFileSync(join(__dirname, 'fixtures', 'demo_seed.sql'), 'utf8'))
    } catch (e) {
      throw new Error(`Seed failed: ${(e as Error).message}`)
    }
  }
  return db
}

export const USERS = {
  admin: '10000000-0000-4000-a000-000000000001',
  hr: '10000000-0000-4000-a000-000000000002',
  finance: '10000000-0000-4000-a000-000000000003',
  manager: '10000000-0000-4000-a000-000000000004',
  employee: '10000000-0000-4000-a000-000000000005',
  field: '10000000-0000-4000-a000-000000000006',
  kiosk: '10000000-0000-4000-a000-000000000007',
  md: '10000000-0000-4000-a000-000000000008',
} as const

export const EMP = {
  admin: '60000000-0000-4000-a000-000000000001',
  hr: '60000000-0000-4000-a000-000000000002',
  finance: '60000000-0000-4000-a000-000000000003',
  manager: '60000000-0000-4000-a000-000000000004',
  employee: '60000000-0000-4000-a000-000000000005',
  field: '60000000-0000-4000-a000-000000000006',
  meena: '60000000-0000-4000-a000-000000000009',
} as const

/** Run queries as an authenticated user with RLS applied (like PostgREST does). */
export async function asUser<T>(db: PGlite, userId: string, fn: (q: <R = any>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`)
  try {
    return await fn(async (sql, params) => (await db.query(sql, params)).rows as any)
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
