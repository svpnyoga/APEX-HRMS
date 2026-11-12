import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/lib/api'

export type Access = {
  user_id: string
  organisation_id: string | null
  employee_id: string | null
  roles: string[]
  permissions: string[]
  is_manager: boolean
  active: boolean
}

type AuthCtx = {
  session: Session | null
  loading: boolean
  access: Access | null
  profile: { full_name: string | null; email: string; avatar_url: string | null } | null
  can: (perm: string | string[]) => boolean
  signOut: () => Promise<void>
  refresh: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setBooting(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') qc.clear()
      if (event === 'SIGNED_IN' && s) {
        supabase.from('user_sessions').insert({ user_id: s.user.id, event: 'login', user_agent: navigator.userAgent }).then(() => undefined)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const accessQ = useQuery({
    queryKey: ['access', session?.user.id],
    enabled: !!session,
    staleTime: 5 * 60_000,
    queryFn: () => rpc<Access>('get_my_access'),
  })
  const profileQ = useQuery({
    queryKey: ['profile', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data } = await supabase.from('user_profiles').select('full_name, email, avatar_url').eq('id', session!.user.id).maybeSingle()
      return data
    },
  })

  const value = useMemo<AuthCtx>(() => {
    const perms = new Set(accessQ.data?.permissions ?? [])
    return {
      session,
      loading: booting || (!!session && accessQ.isLoading),
      access: accessQ.data ?? null,
      profile: profileQ.data ?? null,
      can: (p) => (Array.isArray(p) ? p.some((x) => perms.has(x)) : perms.has(p)),
      signOut: async () => {
        if (session) await supabase.from('user_sessions').insert({ user_id: session.user.id, event: 'logout', user_agent: navigator.userAgent })
        await supabase.auth.signOut()
      },
      refresh: () => { accessQ.refetch(); profileQ.refetch() },
    }
  }, [session, booting, accessQ.data, accessQ.isLoading, profileQ.data])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

/** Convenience: current org / employee ids (throws if not linked, guarded by layout). */
export function useMe() {
  const { access, profile } = useAuth()
  return { orgId: access?.organisation_id ?? '', employeeId: access?.employee_id ?? '', userId: access?.user_id ?? '', name: profile?.full_name ?? '' }
}

/** True when the user only has self-service permissions — they get the employee portal. */
export function isSelfServiceOnly(perms: string[]) {
  const self = new Set(['attendance.clock', 'leave.apply', 'claims.submit'])
  return perms.every((p) => self.has(p))
}
