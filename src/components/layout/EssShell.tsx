import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useRpc } from '@/hooks/data'
import { usePreloadFace } from '@/face/preload'
import { CalendarDays, Clock, Home, Receipt, Wallet, GraduationCap, Target, Megaphone, UserMinus, Inbox, User, Users, MoreHorizontal } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { cn } from '@/lib/utils'
import { Logo } from './Sidebar'
import { NotificationBell, UserMenu } from './Topbar'

const ITEMS = [
  { to: '/me', label: 'Home', icon: Home, end: true },
  { to: '/me/attendance', label: 'Attendance', icon: Clock },
  { to: '/me/leave', label: 'Leave', icon: CalendarDays },
  { to: '/me/claims', label: 'Claims', icon: Receipt },
  { to: '/me/payslips', label: 'Payslips', icon: Wallet },
  { to: '/me/learning', label: 'Learning', icon: GraduationCap },
  { to: '/me/performance', label: 'Performance', icon: Target },
  { to: '/me/announcements', label: 'News', icon: Megaphone },
  { to: '/me/community', label: 'Community', icon: Users },
  { to: '/me/approvals', label: 'Approvals', icon: Inbox, manager: true },
  { to: '/me/profile', label: 'Profile', icon: User },
  { to: '/me/resignation', label: 'Resignation', icon: UserMinus },
]
const MOBILE = ['/me', '/me/attendance', '/me/leave', '/me/claims']

export function EssShell() {
  const { access } = useAuth()
  const items = ITEMS.filter((i) => !i.manager || access?.is_manager)
  const [more, setMore] = useState(false)
  const loc = useLocation()
  useEffect(() => setMore(false), [loc.pathname])
  const extra = items.filter((i) => !MOBILE.includes(i.to))
  const inMore = extra.some((i) => loc.pathname.startsWith(i.to))
  // A: load the face models in the background for enrolled employees, so clock-in starts instantly
  const home = useRpc<any>(['my-home'], 'my_home', undefined, !!access?.employee_id)
  const hs = home.data?.settings
  usePreloadFace(!!(hs?.face_enabled && hs?.face_preload && home.data?.face?.status === 'enrolled'), hs?.face_provider)
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-line bg-ink text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Logo />
          <div className="flex-1" />
          <div className="[&>button]:text-ink-text [&>button:hover]:bg-white/10 [&>button:hover]:text-white"><NotificationBell /></div>
          <div className="rounded-full bg-white/10 p-0.5"><UserMenu portal="self" /></div>
        </div>
        <nav className="mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-3 pb-2 md:flex" aria-label="Self-service">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => cn('flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px]', isActive ? 'bg-white text-ink' : 'text-ink-muted hover:bg-ink-soft hover:text-white')}>
              <i.icon className="h-4 w-4" />{i.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto pb-20 md:pb-6 scrollbar-thin">
        <div className="mx-auto max-w-6xl px-4 py-5"><Outlet /></div>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Self-service">
        {items.filter((i) => MOBILE.includes(i.to)).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-primary' : 'text-muted')}>
            <i.icon className="h-5 w-5" />{i.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', more || inMore ? 'text-primary' : 'text-muted')}>
          <MoreHorizontal className="h-5 w-5" />More
        </button>
      </nav>
      {more && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMore(false)} />
          <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 grid grid-cols-3 gap-1 rounded-t-xl border-t border-line bg-surface p-3 md:hidden">
            {extra.map((i) => (
              <NavLink key={i.to} to={i.to} className={({ isActive }) => cn('flex flex-col items-center gap-1 rounded-lg py-3 text-xs', isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-raised')}>
                <i.icon className="h-5 w-5" />{i.label}
              </NavLink>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
