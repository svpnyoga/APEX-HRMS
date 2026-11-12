import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import * as D from '@radix-ui/react-dialog'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('sidebar') === 'collapsed' } catch { return false } })
  const [mobile, setMobile] = useState(false)
  const loc = useLocation()
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('sidebar', c ? 'open' : 'collapsed') } catch { /* ignore */ } return !c })
  return (
    <div className="flex h-full">
      <div className="hidden h-full lg:block"><Sidebar collapsed={collapsed} onToggle={toggle} /></div>
      <D.Root open={mobile} onOpenChange={setMobile}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 lg:hidden" aria-describedby={undefined}>
            <D.Title className="sr-only">Navigation</D.Title>
            <Sidebar collapsed={false} onNavigate={() => setMobile(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobile(true)} />
        <main key={loc.pathname} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8"><Outlet /></div>
        </main>
      </div>
    </div>
  )
}
