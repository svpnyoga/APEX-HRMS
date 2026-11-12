import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, LogOut, Menu as MenuIcon, Moon, Search, Sun, User, LayoutGrid, Smartphone, Inbox } from 'lucide-react'
import { useAuth, useMe } from '@/app/auth'
import { NAV, visibleNav } from '@/app/nav'
import { useDirectory } from '@/hooks/data'
import { db, unwrap } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { ago, cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/ui/menu'
import { Dialog } from '@/components/ui/dialog'
import { useTheme } from './theme'

export function useNotifications() {
  const { userId } = useMe()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: () => unwrap<any[]>(db.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)),
  })
  useEffect(() => {
    if (!userId) return
    const ch = supabase.channel(`notif-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => qc.invalidateQueries({ queryKey: ['notifications', userId] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [userId, qc])
  const markAll = async () => {
    await db.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    qc.invalidateQueries({ queryKey: ['notifications', userId] })
  }
  const markOne = async (id: string) => {
    await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['notifications', userId] })
  }
  return { ...q, unread: (q.data ?? []).filter((n) => !n.read_at).length, markAll, markOne }
}

export function NotificationBell() {
  const n = useNotifications()
  const nav = useNavigate()
  return (
    <Popover className="w-[360px] p-0" trigger={
      <button className="relative rounded-md p-2 text-muted hover:bg-raised hover:text-text" aria-label={`Notifications${n.unread ? `, ${n.unread} unread` : ''}`}>
        <Bell className="h-[18px] w-[18px]" />
        {n.unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{n.unread > 9 ? '9+' : n.unread}</span>}
      </button>
    }>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">Notifications</span>
        {n.unread > 0 && <button onClick={n.markAll} className="flex items-center gap-1 text-xs text-primary hover:underline"><CheckCheck className="h-3.5 w-3.5" /> Mark all read</button>}
      </div>
      <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
        {(n.data ?? []).length === 0 && <div className="px-4 py-10 text-center text-sm text-muted"><Inbox className="mx-auto mb-2 h-5 w-5 text-subtle" />You're all caught up</div>}
        {(n.data ?? []).slice(0, 20).map((x) => (
          <button key={x.id} onClick={() => { n.markOne(x.id); if (x.link) nav(x.link) }}
            className={cn('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-raised', !x.read_at && 'bg-primary-soft/40')}>
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.read_at ? 'bg-transparent' : 'bg-primary')} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{x.title}</span>
              {x.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{x.body}</span>}
              <span className="mt-1 block text-[11px] text-subtle">{ago(x.created_at)}</span>
            </span>
          </button>
        ))}
      </div>
      <Link to="/notifications" className="block border-t border-line px-4 py-2 text-center text-xs font-medium text-primary hover:bg-raised">View all</Link>
    </Popover>
  )
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const { can } = useAuth()
  const nav = useNavigate()
  const dir = useDirectory()
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const pages = useMemo(() => visibleNav(can).flatMap((m) => m.items.map((i) => ({ ...i, module: m.label }))), [can])
  const needle = q.toLowerCase().trim()
  const pageHits = needle ? pages.filter((p) => `${p.label} ${p.module}`.toLowerCase().includes(needle)).slice(0, 8) : pages.slice(0, 6)
  const empHits = needle ? (dir.data ?? []).filter((e) => `${e.full_name} ${e.employee_code} ${e.designation_name ?? ''}`.toLowerCase().includes(needle)).slice(0, 6) : []
  const go = (to: string) => { setOpen(false); setQ(''); nav(to) }
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-line bg-raised px-3 text-sm text-subtle hover:border-primary/40">
        <Search className="h-4 w-4" /> <span className="flex-1 text-left">Search people and pages</span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 text-[11px] sm:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Search" size="md">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, employee code or page"
          className="mb-3 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-primary" />
        {empHits.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs text-muted">People</div>
            {empHits.map((e) => (
              <button key={e.id} onClick={() => go(can(['employees.view', 'employees.view_team']) ? `/employees/${e.id}` : '/employees')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised">
                <Avatar name={e.full_name} src={e.photo_url} size={24} /><span className="flex-1">{e.full_name}</span><span className="text-xs text-muted">{e.designation_name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="text-xs text-muted">Pages</div>
        {pageHits.map((p) => (
          <button key={p.path + p.label} onClick={() => go(p.path)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised">
            <span>{p.label}</span><span className="text-xs text-subtle">{p.module}</span>
          </button>
        ))}
        {needle && pageHits.length === 0 && empHits.length === 0 && <p className="py-6 text-center text-sm text-muted">No results for "{q}"</p>}
      </Dialog>
    </>
  )
}

export function UserMenu({ portal }: { portal: 'admin' | 'self' }) {
  const { profile, access, signOut } = useAuth()
  const nav = useNavigate()
  const { theme, toggle } = useTheme()
  const hasAdmin = (access?.permissions ?? []).some((p) => !['attendance.clock', 'leave.apply', 'claims.submit'].includes(p)) || access?.is_manager
  return (
    <Menu trigger={
      <button className="flex items-center gap-2 rounded-md p-1 hover:bg-raised" aria-label="Account menu">
        <Avatar name={profile?.full_name} src={profile?.avatar_url} size={30} />
      </button>
    }>
      <MenuLabel><span className="block font-medium text-text">{profile?.full_name}</span><span className="block">{profile?.email}</span></MenuLabel>
      <MenuSeparator />
      <MenuItem onSelect={() => nav('/me/profile')}><User /> My profile</MenuItem>
      {portal === 'admin' ? <MenuItem onSelect={() => nav('/me')}><Smartphone /> Employee self-service</MenuItem>
        : hasAdmin ? <MenuItem onSelect={() => nav('/')}><LayoutGrid /> HR & manager portal</MenuItem> : null}
      <MenuItem onSelect={toggle}>{theme === 'dark' ? <Sun /> : <Moon />} {theme === 'dark' ? 'Light' : 'Dark'} theme</MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={signOut}><LogOut /> Sign out</MenuItem>
    </Menu>
  )
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation"><MenuIcon /></Button>
      <div className="flex-1"><GlobalSearch /></div>
      <NotificationBell />
      <UserMenu portal="admin" />
    </header>
  )
}

export const ALL_NAV_PATHS = NAV.flatMap((m) => m.items.map((i) => i.path.split('?')[0]))
