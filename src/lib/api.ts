import { supabase } from './supabase'

/** Throwing wrappers so TanStack Query surfaces errors consistently. */
export async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

export async function unwrap<T>(p: PromiseLike<{ data: T | null; error: any; count?: number | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw error
  return data as T
}

export const db = supabase
