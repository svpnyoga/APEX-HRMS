import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

export type DirectoryRow = {
  id: string; employee_code: string; full_name: string; first_name: string; last_name: string; photo_url: string | null; official_email: string | null
  department_id: string | null; department_name: string | null; designation_id: string | null; designation_name: string | null
  location_id: string | null; location_name: string | null; reporting_manager_id: string | null; status: string; employment_type: string
  date_of_joining: string; is_field_employee: boolean; birthday_mmdd: string | null; user_id: string | null
}

export const useDirectory = (includeExited = false) =>
  useQuery({
    queryKey: ['directory', includeExited],
    staleTime: 60_000,
    queryFn: async () => {
      let q = db.from('employee_directory').select('*').order('first_name')
      if (!includeExited) q = q.neq('status', 'exited')
      return unwrap<DirectoryRow[]>(q)
    },
  })

/** Small reference lists used across forms. */
export function useLookup<T = { id: string; name: string }>(table: string, select = 'id, name', order = 'name', filter?: (q: any) => any) {
  return useQuery({
    queryKey: ['lookup', table, select, order, String(filter)],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q: any = db.from(table).select(select).order(order)
      if (filter) q = filter(q)
      return unwrap<T[]>(q)
    },
  })
}

export function useRpc<T = any>(key: QueryKey, fn: string, args?: Record<string, unknown>, enabled = true) {
  return useQuery({ queryKey: key, enabled, queryFn: () => rpc<T>(fn, args) })
}

/** Mutation with toast + cache invalidation baked in. */
export function useAction<V = void, R = unknown>(fn: (v: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: QueryKey[]; onSuccess?: (r: R) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success)
      ;(opts.invalidate ?? []).forEach((k) => qc.invalidateQueries({ queryKey: k }))
      opts.onSuccess?.(r)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
}
