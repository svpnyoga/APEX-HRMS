import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNowStrict, parseISO, isValid } from 'date-fns'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-IN')

export const money = (v: unknown, decimals = false) => (v === null || v === undefined || v === '' ? '—' : (decimals ? inr2 : inr).format(Number(v)))
export const number = (v: unknown) => (v === null || v === undefined ? '—' : num.format(Number(v)))

const toDate = (v: unknown): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : parseISO(String(v))
  return isValid(d) ? d : null
}
export const fmtDate = (v: unknown, f = 'dd MMM yyyy') => { const d = toDate(v); return d ? format(d, f) : '—' }
export const fmtDateTime = (v: unknown) => fmtDate(v, 'dd MMM yyyy, HH:mm')
export const fmtTime = (v: unknown) => {
  if (!v) return '—'
  if (typeof v === 'string' && /^\d{2}:\d{2}/.test(v)) return v.slice(0, 5)
  return fmtDate(v, 'HH:mm')
}
export const ago = (v: unknown) => { const d = toDate(v); return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : '—' }
export const minutes = (m: unknown) => {
  const n = Number(m || 0)
  if (!n) return '0h'
  const h = Math.floor(n / 60)
  const r = Math.round(n % 60)
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`
}
export const isoDate = (d: Date = new Date()) => format(d, 'yyyy-MM-dd')
export const titleCase = (s: unknown) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
export const initials = (name?: string | null) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()

/** Turn a Postgres / Supabase error into a sentence a person can act on. */
export function errorMessage(e: unknown): string {
  const anyE = e as { message?: string; details?: string; hint?: string; code?: string }
  if (!anyE) return 'Something went wrong'
  if (anyE.code === '42501' || /permission denied|row-level security/i.test(anyE.message || '')) return 'You do not have permission to do this.'
  if (anyE.code === '23505') return 'That record already exists.'
  if (anyE.code === '23503') return 'This record is linked to other data and cannot be changed this way.'
  if (/Failed to fetch|NetworkError/i.test(anyE.message || '')) return 'Cannot reach the server. Check your connection and try again.'
  return anyE.message || String(e)
}

export async function sha256Hex(file: Blob) {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
