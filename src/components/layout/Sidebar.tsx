import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { visibleNav } from '@/app/nav'
import { cn } from '@/lib/utils'

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="rgb(var(--primary))" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="1.6" />
        <path d="M16 5.5v3.5M16 23v3.5M5.5 16H9M23 16h3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.2" fill="#fff" />
      </svg>
      {!compact && <div className="leading-tight"><div className="text-[15px] font-semibold text-white">Apex HRMS</div><div className="text-[11px] text-ink-muted">People operations</div></div>}
    </div>
  )
}

export function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const { can, access } = useAuth()
  const loc = useLocation()
  const nav = visibleNav(can, !!access?.employee_id)
  const activeModule = nav.find((m) => m.items.some((i) => i.path.split('?')[0] === loc.pathname))?.key
  const [open, setOpen] = useState<Record<string, boolean>>(() => (activeModule ? { [activeModule]: true } : { dashboard: true }))
  useEffect(() => { if (activeModule) setOpen((o) => ({ ...o, [activeModule]: true })) }, [activeModule])

  return (
    <aside className={cn('flex h-full flex-col bg-ink text-ink-text transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-[264px]')}>
      <div className="flex h-14 items-center justify-between px-4">
        <Logo compact={collapsed} />
        {onToggle && !collapsed && (
          <button onClick={onToggle} className="rounded-md p-1.5 text-ink-muted hover:bg-ink-soft hover:text-white" aria-label="Collapse sidebar"><PanelLeftClose className="h-4 w-4" /></button>
        )}
      </div>
      {collapsed && onToggle && (
        <button onClick={onToggle} className="mx-auto mb-2 rounded-md p-1.5 text-ink-muted hover:bg-ink-soft hover:text-white" aria-label="Expand sidebar"><PanelLeftOpen className="h-4 w-4" /></button>
      )}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin" aria-label="Main">
        {nav.map((m) => {
          const isOpen = open[m.key] && !collapsed
          const active = m.key === activeModule
          return (
            <div key={m.key} className="mb-0.5">
              <button
                onClick={() => (collapsed ? onToggle?.() : setOpen((o) => ({ ...o, [m.key]: !o[m.key] })))}
                title={collapsed ? m.label : undefined}
                aria-expanded={isOpen}
                className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                  active ? 'bg-ink-soft text-white' : 'text-ink-text/80 hover:bg-ink-soft/70 hover:text-white', collapsed && 'justify-center')}>
                <m.icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-[#A5A8FF]' : 'text-ink-muted')} />
                {!collapsed && <span className="flex-1 truncate text-left">{m.label}</span>}
                {!collapsed && <ChevronDown className={cn('h-3.5 w-3.5 text-ink-muted transition-transform', isOpen && 'rotate-180')} />}
              </button>
              {isOpen && (
                <div className="my-1 ml-[21px] border-l border-ink-line pl-2">
                  {m.items.map((i) => {
                    const [p, s] = i.path.split('?')
                    const isActive = loc.pathname === p && (!s || loc.search === `?${s}`)
                    return (
                      <NavLink key={i.path + i.label} to={i.path} onClick={onNavigate}
                        className={cn('block truncate rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                          isActive ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-ink-soft hover:text-white')}>
                        {i.label}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
